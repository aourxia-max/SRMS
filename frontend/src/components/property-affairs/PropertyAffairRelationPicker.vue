<script setup lang="ts">
import { ElMessage } from 'element-plus'
import { computed, onMounted, ref, watch } from 'vue'
import { listContracts } from '../../services/contracts'
import { http } from '../../services/http'
import { listAllTenantOptions } from '../../services/tenant-options'
import type { PropertyAffairRelationsPayload, PropertyAffairSummary } from '../../types/property-affairs'

type InitialRelations = Pick<PropertyAffairSummary, 'buildings' | 'rooms' | 'tenants' | 'contracts'>
type Option = { id: number; label: string }
type ContractOption = { id: number; contractNo: string; room?: { fullHouseNo?: string }; members?: Array<{ memberRole: string; tenant: { name: string } }> }

const props = defineProps<{
  modelValue: PropertyAffairRelationsPayload
  initialRelations?: InitialRelations | null
  disabled?: boolean
}>()
const emit = defineEmits<{ 'update:modelValue': [value: PropertyAffairRelationsPayload] }>()

const loading = ref(false)
const initialLocal = normalized(props.modelValue)
const local = ref<PropertyAffairRelationsPayload>(initialLocal)
const buildingOptions = ref<Option[]>(seededOptions('buildings', initialLocal.buildingIds))
const roomOptions = ref<Option[]>(seededOptions('rooms', initialLocal.roomIds))
const tenantOptions = ref<Option[]>(seededOptions('tenants', initialLocal.tenantIds))
const contractOptions = ref<Option[]>(seededOptions('contracts', initialLocal.contractIds))

function ids(value: unknown): number[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.map(Number).filter((item) => Number.isInteger(item) && item > 0))]
}

function normalized(value: PropertyAffairRelationsPayload): PropertyAffairRelationsPayload {
  return { buildingIds: ids(value.buildingIds), roomIds: ids(value.roomIds), tenantIds: ids(value.tenantIds), contractIds: ids(value.contractIds) }
}

function mergeOptions(current: Option[], history: Option[]) {
  const seen = new Set<number>()
  return [...current, ...history].filter((item) => item.label && !seen.has(item.id) && seen.add(item.id))
}

function historicalOptions(kind: keyof InitialRelations): Option[] {
  return (props.initialRelations?.[kind] ?? []).map((item) => ({ id: item.id, label: item.currentLabel || item.snapshotLabel }))
}

function seededOptions(kind: keyof InitialRelations, selectedIds: number[]) {
  return mergeOptions(historicalOptions(kind), selectedIds.map((id) => ({ id, label: '名称暂不可用' })))
}

function contractLabel(contract: ContractOption) {
  const primaryTenant = contract.members?.find((member) => member.memberRole === 'PRIMARY')?.tenant.name
  return [contract.contractNo, contract.room?.fullHouseNo, primaryTenant].filter(Boolean).join('｜')
}

async function loadOptions() {
  loading.value = true
  const results = await Promise.allSettled([
    http.get('/properties/buildings').then((response) => response.data.data.map((item: { id: number; buildingNo: string; buildingName?: string | null }) => ({ id: item.id, label: item.buildingName ? `${item.buildingNo}｜${item.buildingName}` : item.buildingNo }))),
    http.get('/properties/rooms').then((response) => response.data.data.map((item: { id: number; fullHouseNo: string }) => ({ id: item.id, label: item.fullHouseNo }))),
    listAllTenantOptions().then((items) => items.map((item) => ({ id: item.id, label: item.phone ? `${item.name}｜${item.phone}` : item.name }))),
    listContracts().then((items) => (items as ContractOption[]).map((item) => ({ id: item.id, label: contractLabel(item) }))),
  ])
  const targets = [buildingOptions, roomOptions, tenantOptions, contractOptions]
  results.forEach((result, index) => {
    if (result.status === 'fulfilled') targets[index].value = mergeOptions(result.value, targets[index].value)
  })
  if (results.some((result) => result.status === 'rejected')) ElMessage.warning('部分关联对象加载失败，已保留当前关联信息')
  loading.value = false
}

function optionTarget(key: keyof PropertyAffairRelationsPayload) {
  return { buildingIds: buildingOptions, roomIds: roomOptions, tenantIds: tenantOptions, contractIds: contractOptions }[key]
}

function ensureReadableSelections(key: keyof PropertyAffairRelationsPayload, selectedIds: number[]) {
  const target = optionTarget(key)
  target.value = mergeOptions(target.value, selectedIds.map((id) => ({ id, label: '名称暂不可用' })))
}

function update(key: keyof PropertyAffairRelationsPayload, value: unknown) {
  const selectedIds = ids(value)
  ensureReadableSelections(key, selectedIds)
  local.value = { ...local.value, [key]: selectedIds }
  emit('update:modelValue', normalized(local.value))
}

function selectedLabels(selectedIds: number[], options: Option[]) {
  const optionMap = new Map(options.map((item) => [item.id, item.label]))
  return selectedIds.map((id) => optionMap.get(id) || '名称暂不可用')
}

const summaries = computed(() => [
  { label: '楼栋', values: selectedLabels(local.value.buildingIds, buildingOptions.value) },
  { label: '房源', values: selectedLabels(local.value.roomIds, roomOptions.value) },
  { label: '承租人', values: selectedLabels(local.value.tenantIds, tenantOptions.value) },
  { label: '合同', values: selectedLabels(local.value.contractIds, contractOptions.value) },
].filter((group) => group.values.length))

watch(() => props.modelValue, (value) => {
  local.value = normalized(value)
  ensureReadableSelections('buildingIds', local.value.buildingIds)
  ensureReadableSelections('roomIds', local.value.roomIds)
  ensureReadableSelections('tenantIds', local.value.tenantIds)
  ensureReadableSelections('contractIds', local.value.contractIds)
}, { deep: true })
onMounted(loadOptions)
</script>

<template>
  <section v-loading="loading" class="relation-picker">
    <div class="relation-grid">
      <el-form-item label="关联楼栋">
        <el-select data-test="relation-buildings" :model-value="local.buildingIds" multiple filterable collapse-tags :disabled="disabled" placeholder="可选择多个楼栋" @update:model-value="update('buildingIds', $event)">
          <el-option v-for="item in buildingOptions" :key="item.id" :label="item.label" :value="item.id" />
        </el-select>
      </el-form-item>
      <el-form-item label="关联房源">
        <el-select data-test="relation-rooms" :model-value="local.roomIds" multiple filterable collapse-tags :disabled="disabled" placeholder="可选择多个房源" @update:model-value="update('roomIds', $event)">
          <el-option v-for="item in roomOptions" :key="item.id" :label="item.label" :value="item.id" />
        </el-select>
      </el-form-item>
      <el-form-item label="关联承租人">
        <el-select data-test="relation-tenants" :model-value="local.tenantIds" multiple filterable collapse-tags :disabled="disabled" placeholder="可选择多个承租人" @update:model-value="update('tenantIds', $event)">
          <el-option v-for="item in tenantOptions" :key="item.id" :label="item.label" :value="item.id" />
        </el-select>
      </el-form-item>
      <el-form-item label="关联合同">
        <el-select data-test="relation-contracts" :model-value="local.contractIds" multiple filterable collapse-tags :disabled="disabled" placeholder="可选择多个合同" @update:model-value="update('contractIds', $event)">
          <el-option v-for="item in contractOptions" :key="item.id" :label="item.label" :value="item.id" />
        </el-select>
      </el-form-item>
    </div>
    <div v-if="summaries.length" data-test="relation-selection-summary" class="selection-summary">
      <p v-for="group in summaries" :key="group.label"><b>{{ group.label }}：</b>{{ group.values.join('、') }}</p>
    </div>
    <p v-else class="relation-hint">可按实际情况同时关联楼栋、房源、承租人和合同，也可不关联。</p>
  </section>
</template>

<style scoped>
.relation-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0 18px; }
.relation-grid :deep(.el-select) { width: 100%; }
.selection-summary { padding: 10px 14px; border-radius: 8px; background: #f5f7fa; color: #475569; font-size: 13px; }
.selection-summary p { margin: 4px 0; overflow-wrap: anywhere; }
.relation-hint { margin: 0; color: #94a3b8; font-size: 13px; }
@media (max-width: 720px) { .relation-grid { grid-template-columns: 1fr; } }
</style>
