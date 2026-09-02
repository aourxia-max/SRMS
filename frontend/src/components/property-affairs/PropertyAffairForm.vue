<script lang="ts">
import type { PropertyAffairStatus as AffairStatus } from '../../types/property-affairs'

const builtInCategories = ['公共维修', '住户沟通', '证件办理', '现场处理', '外部协调']

export function mergePropertyAffairCategories(history: string[]) {
  return [...new Set([...builtInCategories, ...history].map((item) => item.trim()).filter(Boolean))]
}

export function propertyAffairStatusOptions(current: AffairStatus): AffairStatus[] {
  const transitions: Record<AffairStatus, AffairStatus[]> = {
    PENDING: ['IN_PROGRESS', 'COMPLETED', 'CANCELLED'],
    IN_PROGRESS: ['COMPLETED', 'CANCELLED'],
    COMPLETED: ['IN_PROGRESS'],
    CANCELLED: ['IN_PROGRESS'],
  }
  return [current, ...transitions[current]]
}
</script>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import type {
  PropertyAffairDetail,
  PropertyAffairFormModel,
  PropertyAffairPriority,
  PropertyAffairResponsibleUserOption,
  PropertyAffairStatus,
} from '../../types/property-affairs'
import { propertyAffairPriorityLabel, propertyAffairStatusLabel } from '../../utils/property-affair-labels'
import PropertyAffairRelationPicker from './PropertyAffairRelationPicker.vue'

export type PropertyAffairFormSubmission = {
  model: PropertyAffairFormModel
  status: PropertyAffairStatus
  version?: number
  files: File[]
}

const props = defineProps<{
  mode: 'create' | 'edit'
  initial?: PropertyAffairDetail | null
  categories: string[]
  responsibleUsers: PropertyAffairResponsibleUserOption[]
  saving: boolean
}>()
const emit = defineEmits<{ submit: [submission: PropertyAffairFormSubmission]; cancel: [] }>()

const emptyModel = (): PropertyAffairFormModel => ({
  title: '', category: '', priority: 'NORMAL', content: '', responsibleUserId: null,
  externalHandlerName: '', externalPhone: '', externalContact: '',
  buildingIds: [], roomIds: [], tenantIds: [], contractIds: [],
})
const model = reactive<PropertyAffairFormModel>(emptyModel())
const status = ref<PropertyAffairStatus>('PENDING')
const originalStatus = ref<PropertyAffairStatus>('PENDING')
const version = ref<number | undefined>()
const files = ref<File[]>([])
const errors = reactive<Record<string, string>>({})
const categoryOptions = computed(() => mergePropertyAffairCategories(props.categories))
const priorityOptions: PropertyAffairPriority[] = ['NORMAL', 'IMPORTANT', 'URGENT']
const statusOptions = computed(() => propertyAffairStatusOptions(originalStatus.value))

function hydrate(initial?: PropertyAffairDetail | null) {
  Object.assign(model, emptyModel())
  status.value = 'PENDING'
  originalStatus.value = 'PENDING'
  version.value = undefined
  files.value = []
  Object.keys(errors).forEach((key) => delete errors[key])
  if (!initial) return
  Object.assign(model, {
    title: initial.title,
    category: initial.category ?? '',
    priority: initial.priority,
    content: initial.content,
    responsibleUserId: initial.responsibleUserId,
    externalHandlerName: initial.externalHandlerName ?? '',
    externalPhone: initial.externalPhone ?? '',
    externalContact: initial.externalContact ?? '',
    buildingIds: initial.buildings.map((item) => item.id),
    roomIds: initial.rooms.map((item) => item.id),
    tenantIds: initial.tenants.map((item) => item.id),
    contractIds: initial.contracts.map((item) => item.id),
  })
  status.value = initial.status
  originalStatus.value = initial.status
  version.value = initial.version
}

function validate() {
  Object.keys(errors).forEach((key) => delete errors[key])
  const title = model.title.trim()
  const content = model.content.trim()
  if (!title) errors.title = '请输入事项标题'
  else if (Array.from(title).length > 200) errors.title = '标题不能超过200个字符'
  if (Array.from(model.category.trim()).length > 80) errors.category = '分类不能超过80个字符'
  if (!content) errors.content = '请输入事项内容'
  else if (Array.from(content).length > 5000) errors.content = '内容不能超过5000个字符'
  if (Array.from(model.externalHandlerName.trim()).length > 100) errors.externalHandlerName = '外部办理人不能超过100个字符'
  if (Array.from(model.externalPhone.trim()).length > 50) errors.externalPhone = '联系电话不能超过50个字符'
  if (Array.from(model.externalContact.trim()).length > 200) errors.externalContact = '其他联系方式不能超过200个字符'
  return Object.keys(errors).length === 0
}

function submit() {
  if (props.saving || !validate()) return
  emit('submit', {
    model: {
      ...model,
      title: model.title.trim(),
      category: model.category.trim(),
      content: model.content.trim(),
      externalHandlerName: model.externalHandlerName.trim(),
      externalPhone: model.externalPhone.trim(),
      externalContact: model.externalContact.trim(),
      buildingIds: [...model.buildingIds],
      roomIds: [...model.roomIds],
      tenantIds: [...model.tenantIds],
      contractIds: [...model.contractIds],
    },
    status: status.value,
    version: version.value,
    files: [...files.value],
  })
}

function selectFiles(event: Event) {
  files.value = Array.from((event.target as HTMLInputElement).files ?? [])
}

watch(() => props.initial, hydrate, { immediate: true })
</script>

<template>
  <el-form class="affair-form" :model="model" label-position="top" @submit.prevent="submit">
    <section class="form-section">
      <h2>基本信息</h2>
      <div v-if="mode === 'edit'" class="affair-number"><span>事项编号</span><strong>{{ initial?.affairNo }}</strong></div>
      <div class="form-grid">
        <el-form-item label="事项标题" required :error="errors.title">
          <el-input data-test="affair-title" v-model="model.title" maxlength="200" show-word-limit placeholder="请概括需要办理的事项" />
          <p v-if="errors.title" class="field-error">{{ errors.title }}</p>
        </el-form-item>
        <el-form-item label="分类" :error="errors.category">
          <el-select data-test="affair-category" v-model="model.category" filterable allow-create default-first-option clearable placeholder="选择或输入分类">
            <el-option v-for="item in categoryOptions" :key="item" :label="item" :value="item" />
          </el-select>
          <p v-if="errors.category" class="field-error">{{ errors.category }}</p>
        </el-form-item>
        <el-form-item label="优先级" required>
          <el-select v-model="model.priority"><el-option v-for="item in priorityOptions" :key="item" :label="propertyAffairPriorityLabel(item)" :value="item" /></el-select>
        </el-form-item>
        <el-form-item v-if="mode === 'edit'" label="当前状态" required>
          <el-select data-test="affair-status" v-model="status"><el-option v-for="item in statusOptions" :key="item" :label="propertyAffairStatusLabel(item)" :value="item" /></el-select>
        </el-form-item>
        <el-form-item label="内部负责人">
          <el-select data-test="responsible-user" v-model="model.responsibleUserId" filterable clearable placeholder="选择在职管理员"><el-option v-for="item in responsibleUsers" :key="item.id" :label="item.displayName" :value="item.id" /></el-select>
        </el-form-item>
      </div>
      <el-form-item label="事项内容" required :error="errors.content">
        <el-input data-test="affair-content" v-model="model.content" type="textarea" :rows="7" maxlength="5000" show-word-limit placeholder="记录背景、需要处理的问题和当前情况" />
        <p v-if="errors.content" class="field-error">{{ errors.content }}</p>
      </el-form-item>
    </section>

    <section class="form-section">
      <h2>外部联系</h2>
      <div class="form-grid form-grid-three">
        <el-form-item label="外部办理人或单位" :error="errors.externalHandlerName"><el-input data-test="external-handler" v-model="model.externalHandlerName" maxlength="100" /><p v-if="errors.externalHandlerName" class="field-error">{{ errors.externalHandlerName }}</p></el-form-item>
        <el-form-item label="联系电话" :error="errors.externalPhone"><el-input data-test="external-phone" v-model="model.externalPhone" maxlength="50" /><p v-if="errors.externalPhone" class="field-error">{{ errors.externalPhone }}</p></el-form-item>
        <el-form-item label="其他联系方式" :error="errors.externalContact"><el-input data-test="external-contact" v-model="model.externalContact" maxlength="200" /><p v-if="errors.externalContact" class="field-error">{{ errors.externalContact }}</p></el-form-item>
      </div>
    </section>

    <section class="form-section">
      <h2>关联业务对象</h2>
      <PropertyAffairRelationPicker :model-value="model" :initial-relations="initial" :disabled="saving" @update:model-value="Object.assign(model, $event)" />
    </section>

    <section v-if="mode === 'create'" class="form-section">
      <h2>本地附件</h2>
      <label class="file-picker">
        <span>选择图片、PDF、Word 或 Excel 文件</span>
        <input data-test="affair-files" type="file" multiple accept="image/jpeg,image/png,image/webp,application/pdf,.docx,.xlsx,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" @change="selectFiles" />
      </label>
      <p v-if="files.length" class="file-summary">已选择：{{ files.map((file) => file.name).join('、') }}</p>
      <p class="form-hint">事项创建后会依次上传附件；若个别文件失败，已创建事项和成功附件会保留。</p>
    </section>

    <div class="form-actions">
      <el-button :disabled="saving" @click="emit('cancel')">取消</el-button>
      <el-button data-test="submit-affair-form" type="primary" native-type="button" :loading="saving" @click="submit">{{ mode === 'edit' ? '保存修改' : '创建事项' }}</el-button>
    </div>
  </el-form>
</template>

<style scoped>
.affair-form { display: grid; gap: 18px; }
.form-section { padding: 20px; border: 1px solid #e5eaf1; border-radius: 12px; background: #fff; }
.form-section h2 { margin: 0 0 18px; color: #334155; font-size: 17px; }
.form-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0 18px; }
.form-grid-three { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.form-grid :deep(.el-select) { width: 100%; }
.affair-number { display: flex; gap: 16px; margin: -4px 0 18px; padding: 12px 14px; border-radius: 8px; background: #f8fafc; color: #64748b; }
.affair-number strong { color: #1e293b; }
.file-picker { display: flex; min-height: 74px; cursor: pointer; align-items: center; justify-content: center; border: 1px dashed #b8c5d8; border-radius: 10px; color: #2563eb; }
.file-picker input { position: absolute; width: 1px; height: 1px; opacity: 0; }
.file-summary, .form-hint { margin: 10px 0 0; color: #64748b; font-size: 13px; overflow-wrap: anywhere; }
.field-error { width: 100%; margin: 3px 0 0; color: #f56c6c; font-size: 12px; line-height: 1.2; }
.form-actions { position: sticky; bottom: 0; z-index: 2; display: flex; justify-content: flex-end; gap: 10px; padding: 14px 18px; border: 1px solid #e5eaf1; border-radius: 12px; background: rgba(255,255,255,.96); }
@media (max-width: 820px) { .form-grid, .form-grid-three { grid-template-columns: 1fr; } .form-section { padding: 16px; } }
</style>
