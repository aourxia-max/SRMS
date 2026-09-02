<script setup lang="ts">
import { ElMessage, ElMessageBox } from 'element-plus'
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import PropertyAffairTimeline from '../components/property-affairs/PropertyAffairTimeline.vue'
import {
  appendPropertyAffairProgress,
  downloadPropertyAffairFile,
  extractPropertyAffairErrorMessage,
  getPropertyAffair,
  previewPropertyAffairFile,
  softDeletePropertyAffair,
  unlinkPropertyAffairFile,
  uploadPropertyAffairFile,
} from '../services/property-affairs'
import type { PropertyAffairDetail, PropertyAffairFile, PropertyAffairRelation, PropertyAffairStatus } from '../types/property-affairs'
import { propertyAffairAvailabilityLabel, propertyAffairPriorityLabel, propertyAffairStatusLabel } from '../utils/property-affair-labels'

const route = useRoute()
const router = useRouter()
const affairId = computed(() => Number(route.params.id))
const affair = ref<PropertyAffairDetail | null>(null)
const loading = ref(true)
const loadError = ref('')
const deleting = ref(false)
const progressDialog = ref(false)
const progressSaving = ref(false)
const progressForm = reactive({ content: '', nextStatus: '' as PropertyAffairStatus | '' })
const progressError = ref('')
const uploading = ref(false)
const unlinkingIds = ref(new Set<number>())
const downloadingIds = ref(new Set<number>())
const previewingId = ref<number | null>(null)
const previewOpen = ref(false)
const previewUrl = ref('')
const previewName = ref('')
const previewKind = ref<'image' | 'pdf'>('image')
let disposed = false

const nextStatuses = computed<PropertyAffairStatus[]>(() => {
  if (!affair.value) return []
  const transitions: Record<PropertyAffairStatus, PropertyAffairStatus[]> = {
    PENDING: ['IN_PROGRESS', 'COMPLETED', 'CANCELLED'],
    IN_PROGRESS: ['COMPLETED', 'CANCELLED'],
    COMPLETED: ['IN_PROGRESS'],
    CANCELLED: ['IN_PROGRESS'],
  }
  return transitions[affair.value.status]
})

const creatorName = computed(() => {
  if (!affair.value) return '未知管理员'
  return affair.value.progresses.find((progress) => progress.statusBefore === null)?.createdBySnapshot || '管理员'
})

function formatDate(value: string | null) {
  if (!value) return '未记录'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '时间未知' : date.toLocaleString('zh-CN', { hour12: false })
}

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    if (!Number.isInteger(affairId.value) || affairId.value <= 0) throw new Error('办事事项编号无效')
    affair.value = await getPropertyAffair(affairId.value)
  } catch (error) {
    affair.value = null
    loadError.value = extractPropertyAffairErrorMessage(error, '办事事项加载失败，请稍后重试')
  } finally {
    loading.value = false
  }
}

function openProgress() {
  progressForm.content = ''
  progressForm.nextStatus = ''
  progressError.value = ''
  progressDialog.value = true
}

async function submitProgress() {
  if (!affair.value || progressSaving.value) return
  const content = progressForm.content.trim()
  if (!content) {
    progressError.value = '请输入办理进度'
    return
  }
  if (Array.from(content).length > 2000) {
    progressError.value = '办理进度不能超过2000个字符'
    return
  }
  progressError.value = ''
  progressSaving.value = true
  try {
    await appendPropertyAffairProgress(affair.value.id, {
      version: affair.value.version,
      content,
      ...(progressForm.nextStatus ? { nextStatus: progressForm.nextStatus } : {}),
    })
    progressDialog.value = false
    await load()
    ElMessage.success('办理进度已追加')
  } catch (error) {
    ElMessage.error(extractPropertyAffairErrorMessage(error, '办理进度提交失败，已填写内容仍保留'))
  } finally {
    progressSaving.value = false
  }
}

async function removeAffair() {
  if (!affair.value || deleting.value) return
  deleting.value = true
  try {
    await ElMessageBox.confirm(`确认将“${affair.value.title}”移入回收站吗？`, '删除确认', { confirmButtonText: '移入回收站', cancelButtonText: '取消', type: 'warning' })
    await softDeletePropertyAffair(affair.value.id, affair.value.version)
    ElMessage.success('办事事项已移入回收站')
    await router.push({ name: 'property-affairs' })
  } catch (error) {
    if (error !== 'cancel' && error !== 'close') ElMessage.error(extractPropertyAffairErrorMessage(error, '删除失败，请稍后重试'))
  } finally {
    deleting.value = false
  }
}

async function uploadFiles(event: Event) {
  if (!affair.value || uploading.value) return
  const input = event.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  if (!files.length) return
  uploading.value = true
  const failed: string[] = []
  let succeeded = 0
  try {
    for (const file of files) {
      try {
        await uploadPropertyAffairFile(affair.value.id, file)
        succeeded += 1
        await load()
      } catch {
        failed.push(file.name)
      }
    }
    if (failed.length) ElMessage.warning(`以下附件上传失败：${failed.join('、')}。已成功上传 ${succeeded} 个文件。`)
    else ElMessage.success(files.length > 1 ? '附件已全部上传' : '附件已上传')
  } finally {
    uploading.value = false
    input.value = ''
  }
}

async function unlinkFile(file: PropertyAffairFile) {
  if (!affair.value || unlinkingIds.value.has(file.id)) return
  unlinkingIds.value.add(file.id)
  try {
    await ElMessageBox.confirm(`确认解除附件“${file.originalName}”与本事项的关联吗？`, '解除附件确认', { confirmButtonText: '确认解除', cancelButtonText: '取消', type: 'warning' })
    await unlinkPropertyAffairFile(affair.value.id, file.id)
    await load()
    ElMessage.success('附件关联已解除')
  } catch (error) {
    if (error !== 'cancel' && error !== 'close') ElMessage.error(extractPropertyAffairErrorMessage(error, '解除附件失败，请稍后重试'))
  } finally {
    unlinkingIds.value.delete(file.id)
  }
}

function isPreviewable(file: PropertyAffairFile) {
  return file.mimeType === 'application/pdf' || file.mimeType.startsWith('image/')
}

function releasePreview() {
  if (previewUrl.value) URL.revokeObjectURL(previewUrl.value)
  previewUrl.value = ''
  previewName.value = ''
}

async function previewFile(file: PropertyAffairFile) {
  if (!affair.value || !isPreviewable(file) || previewingId.value !== null) return
  previewingId.value = file.id
  try {
    const blob = await previewPropertyAffairFile(affair.value.id, file.id)
    if (disposed) return
    releasePreview()
    previewUrl.value = URL.createObjectURL(blob)
    previewName.value = file.originalName
    previewKind.value = file.mimeType === 'application/pdf' ? 'pdf' : 'image'
    previewOpen.value = true
  } catch (error) {
    ElMessage.error(extractPropertyAffairErrorMessage(error, '附件预览失败，请下载后查看'))
  } finally {
    previewingId.value = null
  }
}

function safeFilename(value: string) {
  const name = value.replace(/^.*[\\/]/, '').replace(/[\u0000-\u001f\u007f]/g, '').trim()
  return name || '物业办事附件'
}

async function downloadFile(file: PropertyAffairFile) {
  if (!affair.value || downloadingIds.value.has(file.id)) return
  downloadingIds.value.add(file.id)
  let objectUrl = ''
  try {
    const blob = await downloadPropertyAffairFile(affair.value.id, file.id)
    objectUrl = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = objectUrl
    anchor.download = safeFilename(file.originalName)
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
  } catch (error) {
    ElMessage.error(extractPropertyAffairErrorMessage(error, '附件下载失败，请稍后重试'))
  } finally {
    if (objectUrl) URL.revokeObjectURL(objectUrl)
    downloadingIds.value.delete(file.id)
  }
}

function relationText(item: PropertyAffairRelation) {
  return item.currentLabel || item.snapshotLabel || '关联对象名称未知'
}

watch(previewOpen, (open) => { if (!open) releasePreview() })
onMounted(load)
onBeforeUnmount(() => {
  disposed = true
  releasePreview()
})
</script>

<template>
  <main class="property-affair-detail-page">
    <el-skeleton v-if="loading && !affair" :rows="8" animated />
    <el-alert v-else-if="loadError" :title="loadError" type="error" :closable="false" show-icon />
    <template v-else-if="affair">
      <header class="detail-header">
        <div>
          <div class="header-tags"><el-tag :type="affair.priority === 'URGENT' ? 'danger' : affair.priority === 'IMPORTANT' ? 'warning' : 'info'">{{ propertyAffairPriorityLabel(affair.priority) }}</el-tag><el-tag type="primary">{{ propertyAffairStatusLabel(affair.status) }}</el-tag></div>
          <h1>{{ affair.title }}</h1>
          <p>{{ affair.affairNo }}</p>
        </div>
        <div class="header-actions">
          <el-button @click="router.push({ name: 'property-affairs' })">返回列表</el-button>
          <el-button data-test="edit-affair" type="primary" plain @click="router.push({ name: 'property-affair-edit', params: { id: affair.id } })">编辑</el-button>
          <el-button data-test="delete-affair" type="danger" plain :loading="deleting" @click="removeAffair">删除</el-button>
        </div>
      </header>

      <el-card>
        <template #header><strong>办理信息</strong></template>
        <dl class="info-grid">
          <div><dt>内部负责人</dt><dd>{{ affair.responsibleSnapshot || '未指定' }}</dd></div>
          <div><dt>外部办理人或单位</dt><dd>{{ affair.externalHandlerName || '未记录' }}</dd></div>
          <div><dt>联系电话</dt><dd>{{ affair.externalPhone || '未记录' }}</dd></div>
          <div><dt>其他联系方式</dt><dd>{{ affair.externalContact || '未记录' }}</dd></div>
          <div><dt>创建人</dt><dd>{{ creatorName }}</dd></div>
          <div><dt>创建时间</dt><dd>{{ formatDate(affair.createdAt) }}</dd></div>
          <div><dt>最近更新</dt><dd>{{ formatDate(affair.updatedAt) }}</dd></div>
          <div><dt>完成时间</dt><dd>{{ formatDate(affair.completedAt) }}</dd></div>
        </dl>
      </el-card>

      <el-card>
        <template #header><strong>事项内容</strong></template>
        <p class="content-text">{{ affair.content }}</p>
      </el-card>

      <el-card>
        <template #header><strong>关联业务对象</strong></template>
        <div class="relation-groups">
          <section><h3>楼栋</h3><el-empty v-if="!affair.buildings.length" description="未关联楼栋" :image-size="44" /><div v-for="item in affair.buildings" :key="item.id" class="relation-item"><router-link :data-test="`building-link-${item.id}`" :to="{ name: 'properties', query: { buildingId: item.id } }">{{ relationText(item) }}</router-link><small>关联时：{{ item.snapshotLabel }} · {{ propertyAffairAvailabilityLabel(item.available) }}</small></div></section>
          <section><h3>房源</h3><el-empty v-if="!affair.rooms.length" description="未关联房源" :image-size="44" /><div v-for="item in affair.rooms" :key="item.id" class="relation-item"><router-link :data-test="`room-link-${item.id}`" :to="{ name: 'room-detail', params: { id: item.id } }">{{ relationText(item) }}</router-link><small>关联时：{{ item.snapshotLabel }} · {{ propertyAffairAvailabilityLabel(item.available) }}</small></div></section>
          <section><h3>承租人</h3><el-empty v-if="!affair.tenants.length" description="未关联承租人" :image-size="44" /><div v-for="item in affair.tenants" :key="item.id" class="relation-item"><router-link :data-test="`tenant-link-${item.id}`" :to="`/tenants/${item.id}`">{{ relationText(item) }}</router-link><small>关联时：{{ item.snapshotLabel }} · {{ propertyAffairAvailabilityLabel(item.available) }}</small></div></section>
          <section><h3>合同</h3><el-empty v-if="!affair.contracts.length" description="未关联合同" :image-size="44" /><div v-for="item in affair.contracts" :key="item.id" class="relation-item"><router-link :data-test="`contract-link-${item.id}`" :to="{ name: 'contracts', query: { tab: 'detail', contractId: item.id } }">{{ relationText(item) }}</router-link><small>关联时：{{ item.snapshotLabel }} · {{ propertyAffairAvailabilityLabel(item.available) }}</small></div></section>
        </div>
      </el-card>

      <el-card>
        <template #header><div class="card-header"><strong>附件</strong><label class="upload-button"><span>{{ uploading ? '正在上传…' : '上传附件' }}</span><input data-test="detail-file-input" type="file" multiple :disabled="uploading" accept="image/jpeg,image/png,image/webp,application/pdf,.docx,.xlsx,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" @change="uploadFiles" /></label></div></template>
        <el-empty v-if="affair.files.length === 0" description="暂无附件" :image-size="56" />
        <ul v-else class="file-list">
          <li v-for="file in affair.files" :key="file.id"><span class="file-name">{{ file.originalName }}</span><div><el-button v-if="isPreviewable(file)" :data-test="`preview-file-${file.id}`" size="small" link type="primary" :loading="previewingId === file.id" @click="previewFile(file)">预览</el-button><el-button :data-test="`download-file-${file.id}`" size="small" link :loading="downloadingIds.has(file.id)" @click="downloadFile(file)">下载</el-button><el-button :data-test="`unlink-file-${file.id}`" size="small" link type="danger" :loading="unlinkingIds.has(file.id)" @click="unlinkFile(file)">解除关联</el-button></div></li>
        </ul>
      </el-card>

      <el-card>
        <template #header><div class="card-header"><strong>办理进度</strong><el-button data-test="open-progress-dialog" type="primary" @click="openProgress">追加进度</el-button></div></template>
        <PropertyAffairTimeline :progresses="affair.progresses" />
      </el-card>
    </template>

    <el-dialog v-model="progressDialog" title="追加办理进度" width="min(620px, 92vw)" :teleported="false" :close-on-click-modal="false">
      <el-form label-position="top">
        <el-form-item label="办理说明" required :error="progressError"><el-input data-test="progress-content" v-model="progressForm.content" type="textarea" :rows="6" maxlength="2000" show-word-limit /><p v-if="progressError" class="field-error">{{ progressError }}</p></el-form-item>
        <el-form-item label="同时调整状态"><el-select data-test="progress-next-status" v-model="progressForm.nextStatus" clearable placeholder="仅追加说明（状态不变）"><el-option v-for="item in nextStatuses" :key="item" :label="propertyAffairStatusLabel(item)" :value="item" /></el-select></el-form-item>
      </el-form>
      <template #footer><el-button :disabled="progressSaving" @click="progressDialog = false">取消</el-button><el-button data-test="submit-progress" type="primary" :loading="progressSaving" @click="submitProgress">提交进度</el-button></template>
    </el-dialog>

    <el-dialog data-test="attachment-preview-dialog" v-model="previewOpen" :title="`预览：${previewName}`" width="min(980px, 94vw)" :teleported="false" destroy-on-close>
      <div class="preview-stage"><img v-if="previewKind === 'image' && previewUrl" data-test="image-preview" :src="previewUrl" :alt="previewName" /><iframe v-else-if="previewUrl" data-test="pdf-preview" :src="previewUrl" :title="previewName" /></div>
    </el-dialog>
  </main>
</template>

<style scoped>
.property-affair-detail-page { display: grid; gap: 18px; }
.detail-header, .card-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 18px; }
.detail-header h1 { margin: 10px 0 6px; color: #1e293b; font-size: 28px; }
.detail-header p { margin: 0; color: #64748b; font-family: ui-monospace, SFMono-Regular, Consolas, monospace; }
.header-tags, .header-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.info-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 18px; margin: 0; }
.info-grid div { min-width: 0; }.info-grid dt { color: #94a3b8; font-size: 12px; }.info-grid dd { margin: 6px 0 0; color: #334155; overflow-wrap: anywhere; }
.content-text { margin: 0; color: #334155; line-height: 1.8; white-space: pre-wrap; overflow-wrap: anywhere; }
.relation-groups { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
.relation-groups section { padding: 14px; border-radius: 10px; background: #f8fafc; }.relation-groups h3 { margin: 0 0 10px; color: #475569; font-size: 14px; }
.relation-item { display: grid; gap: 3px; margin-top: 9px; }.relation-item a { color: #2563eb; text-decoration: none; overflow-wrap: anywhere; }.relation-item small { color: #94a3b8; }
.upload-button { display: inline-flex; cursor: pointer; align-items: center; padding: 7px 14px; border-radius: 7px; background: #2563eb; color: #fff; font-size: 14px; }.upload-button input { position: absolute; width: 1px; height: 1px; opacity: 0; }
.file-list { margin: 0; padding: 0; list-style: none; }.file-list li { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 11px 0; border-bottom: 1px solid #edf1f5; }.file-list li:last-child { border-bottom: 0; }.file-name { min-width: 0; overflow-wrap: anywhere; }
.field-error { width: 100%; margin: 3px 0 0; color: #f56c6c; font-size: 12px; }.preview-stage { min-height: 64vh; display: grid; place-items: center; background: #eef2f7; }.preview-stage img { max-width: 100%; max-height: 70vh; object-fit: contain; }.preview-stage iframe { width: 100%; height: 70vh; border: 0; background: #fff; }
@media (max-width: 900px) { .info-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 660px) { .detail-header { flex-direction: column; }.header-actions { width: 100%; }.relation-groups, .info-grid { grid-template-columns: 1fr; }.file-list li { align-items: flex-start; flex-direction: column; } }
</style>
