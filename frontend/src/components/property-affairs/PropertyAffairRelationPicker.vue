<script setup lang="ts">
import { ElMessage } from 'element-plus'
import { computed, onMounted, ref, watch } from 'vue'
import { listContracts } from '../../services/contracts'
import { http } from '../../services/http'
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
const local = ref<PropertyAffairRelationsPayload>(normalized(props.modelValue))
const buildingOptions = ref<Option[]>([])
const roomOptions = ref<Option[]>([])
const tenantOptions = ref<Option[]>([])
const contractOptions = ref<Option[]>([])

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

function contractLabel(contract: ContractOption) {
  const primaryTenant = contract.members?.find((member) => member.memberRole === 'PRIMARY')?.tenant.name
  return [contract.contractNo, contract.room?.fullHouseNo, primaryTenant].filter(Boolean).join('｜')
}

async function loadOptions() {
  loading.value = true
  try {
    const [buildingResponse, roomResponse, tenantResponse, contractData] = await Promise.all([
      http.get('/properties/buildings'),
      http.get('/properties/rooms'),
      http.get('/tenants', { params: { page: 1, pageSize: 100 } }),
      listContracts(),
    ])
    buildingOptions.value = mergeOptions(
      buildingResponse.data.data.map((item: { id: number; buildingNo: string; buildingName?: string | null }) => ({ id: item.id, label: item.buildingName ? `${item.buildingNo}｜${item.buildingName}` : item.buildingNo })),
      historicalOptions('buildings'),
    )
    roomOptions.value = mergeOptions(roomResponse.data.data.map((item: { id: number; fullHouseNo: string }) => ({ id: item.id, label: item.fullHouseNo })), historicalOptions('rooms'))
    tenantOptions.value = mergeOptions(
      tenantResponse.data.data.items.map((item: { id: number; name: string; phone?: string | null }) => ({ id: item.id, label: item.phone ? `${item.name}｜${item.phone}` : item.name })),
      historicalOptions('tenants'),
    )
    contractOptions.value = mergeOptions((contractData as ContractOption[]).map((item) => ({ id: item.id, label: contractLabel(item) })), historicalOptions('contracts'))
  } catch {
    ElMessage.error('关联对象加载失败，请稍后重试')
  } finally {
    loading.value = false
  }
}

function update(key: keyof PropertyAffairRelationsPayload, value: unknown) {
  local.value = { ...local.value, [key]: ids(value) }
  emit('update:modelValue', normalized(local.value))
}

function selectedLabels(selectedIds: number[], options: Option[]) {
  const optionMap = new Map(options.map((item) => [item.id, item.label]))
  return selectedIds.map((id) => optionMap.get(id)).filter((label): label is string => Boolean(label))
}

const summaries = computed(() => [
  { label: '楼栋', values: selectedLabels(local.value.buildingIds, buildingOptions.value) },
  { label: '房源', values: selectedLabels(local.value.roomIds, roomOptions.value) },
  { label: '承租人', values: selectedLabels(local.value.tenantIds, tenantOptions.value) },
  { label: '合同', values: selectedLabels(local.value.contractIds, contractOptions.value) },
].filter((group) => group.values.length))

watch(() => props.modelValue, (value) => { local.value = normalized(value) }, { deep: true })
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
