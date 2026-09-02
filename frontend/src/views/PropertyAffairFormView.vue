<script setup lang="ts">
import { ElMessage } from 'element-plus'
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import PropertyAffairForm from '../components/property-affairs/PropertyAffairForm.vue'
import type { PropertyAffairFormSubmission } from '../components/property-affairs/PropertyAffairForm.vue'
import {
  createPropertyAffair,
  extractPropertyAffairErrorMessage,
  getPropertyAffair,
  listPropertyAffairCategories,
  listPropertyAffairResponsibleUsers,
  updatePropertyAffair,
  uploadPropertyAffairFile,
} from '../services/property-affairs'
import type { PropertyAffairCreatePayload, PropertyAffairDetail, PropertyAffairResponsibleUserOption, PropertyAffairUpdatePayload } from '../types/property-affairs'

const route = useRoute()
const router = useRouter()
const editMode = computed(() => route.name === 'property-affair-edit')
const affairId = computed(() => Number(route.params.id))
const loading = ref(true)
const saving = ref(false)
const loadError = ref('')
const initial = ref<PropertyAffairDetail | null>(null)
const categories = ref<string[]>([])
const responsibleUsers = ref<PropertyAffairResponsibleUserOption[]>([])

function optional(value: string) {
  const trimmed = value.trim()
  return trimmed || undefined
}

function nullable(value: string) {
  const trimmed = value.trim()
  return trimmed || null
}

function createPayload(submission: PropertyAffairFormSubmission): PropertyAffairCreatePayload {
  const model = submission.model
  return {
    title: model.title,
    content: model.content,
    priority: model.priority,
    ...(optional(model.category) ? { category: optional(model.category) } : {}),
    ...(model.responsibleUserId ? { responsibleUserId: model.responsibleUserId } : {}),
    ...(optional(model.externalHandlerName) ? { externalHandlerName: optional(model.externalHandlerName) } : {}),
    ...(optional(model.externalPhone) ? { externalPhone: optional(model.externalPhone) } : {}),
    ...(optional(model.externalContact) ? { externalContact: optional(model.externalContact) } : {}),
    buildingIds: [...model.buildingIds],
    roomIds: [...model.roomIds],
    tenantIds: [...model.tenantIds],
    contractIds: [...model.contractIds],
  }
}

function updatePayload(submission: PropertyAffairFormSubmission): PropertyAffairUpdatePayload {
  if (!submission.version) throw new Error('缺少事项版本号，请刷新后重试')
  const model = submission.model
  return {
    title: model.title,
    category: nullable(model.category),
    priority: model.priority,
    content: model.content,
    responsibleUserId: model.responsibleUserId,
    externalHandlerName: nullable(model.externalHandlerName),
    externalPhone: nullable(model.externalPhone),
    externalContact: nullable(model.externalContact),
    status: submission.status,
    version: submission.version,
    buildingIds: [...model.buildingIds],
    roomIds: [...model.roomIds],
    tenantIds: [...model.tenantIds],
    contractIds: [...model.contractIds],
  }
}

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    if (editMode.value && (!Number.isInteger(affairId.value) || affairId.value <= 0)) throw new Error('办事事项编号无效')
    const [categoryData, userData, affair] = await Promise.all([
      listPropertyAffairCategories(),
      listPropertyAffairResponsibleUsers(),
      editMode.value ? getPropertyAffair(affairId.value) : Promise.resolve(null),
    ])
    categories.value = categoryData
    responsibleUsers.value = userData
    initial.value = affair
  } catch (error) {
    loadError.value = extractPropertyAffairErrorMessage(error, editMode.value ? '办事事项加载失败，请稍后重试' : '办事表单加载失败，请稍后重试')
  } finally {
    loading.value = false
  }
}

async function submit(submission: PropertyAffairFormSubmission) {
  if (saving.value) return
  saving.value = true
  try {
    if (editMode.value) {
      await updatePropertyAffair(affairId.value, updatePayload(submission))
      ElMessage.success('办事事项已更新')
      await router.push({ name: 'property-affair-detail', params: { id: affairId.value } })
      return
    }

    const created = await createPropertyAffair(createPayload(submission))
    const failedFiles: string[] = []
    for (const file of submission.files) {
      try {
        await uploadPropertyAffairFile(created.id, file)
      } catch {
        failedFiles.push(file.name)
      }
    }
    if (failedFiles.length) {
      ElMessage.warning(`办事事项已创建，但以下附件上传失败：${failedFiles.join('、')}。可在详情页重试上传。`)
    } else if (submission.files.length) {
      ElMessage.success('办事事项及附件已创建')
    } else {
      ElMessage.success('办事事项已创建')
    }
    await router.push({ name: 'property-affair-detail', params: { id: created.id } })
  } catch (error) {
    const isConflict = (error as { response?: { status?: number } })?.response?.status === 409
    ElMessage.error(isConflict ? '内容已被其他管理员更新，请刷新后重试' : extractPropertyAffairErrorMessage(error, editMode.value ? '办事事项保存失败，已填写内容仍保留在页面' : '办事事项创建失败，已填写内容仍保留在页面'))
  } finally {
    saving.value = false
  }
}

function cancel() {
  void router.push(editMode.value ? { name: 'property-affair-detail', params: { id: affairId.value } } : { name: 'property-affairs' })
}

onMounted(load)
</script>

<template>
  <main class="property-affair-form-page">
    <header>
      <el-tag type="primary">物业办事</el-tag>
      <h1>{{ editMode ? '编辑办事事项' : '新建办事事项' }}</h1>
      <p>{{ editMode ? '修改主事项信息不会覆盖已经追加的办理进度。' : '先记录事项，创建成功后再上传本地附件。' }}</p>
    </header>
    <el-skeleton v-if="loading" :rows="8" animated />
    <el-alert v-else-if="loadError" :title="loadError" type="error" :closable="false" show-icon />
    <PropertyAffairForm v-else :mode="editMode ? 'edit' : 'create'" :initial="initial" :categories="categories" :responsible-users="responsibleUsers" :saving="saving" @submit="submit" @cancel="cancel" />
  </main>
</template>

<style scoped>
.property-affair-form-page { display: grid; gap: 20px; max-width: 1160px; margin: 0 auto; }
header h1 { margin: 10px 0 6px; color: #1e293b; font-size: 28px; }
header p { margin: 0; color: #64748b; }
</style>
