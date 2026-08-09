<script setup lang="ts">
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import { ElMessage, ElMessageBox } from 'element-plus'
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import ContractDetailPanel from '../../components/contracts/ContractDetailPanel.vue'
import ContractFormPanel from '../../components/contracts/ContractFormPanel.vue'
import ContractListPanel from '../../components/contracts/ContractListPanel.vue'
import ContractSummaryPanel from '../../components/contracts/ContractSummaryPanel.vue'
import ContractTopNav from '../../components/contracts/ContractTopNav.vue'
import FixedRentRebatePanel from '../../components/contracts/FixedRentRebatePanel.vue'
import {
  approveFixedRentRebate,
  confirmContractDraft,
  confirmFixedContract,
  createContractDraft,
  createLatestRequestGuard,
  downloadContractFile,
  getContract,
  getContractBills,
  getContractChanges,
  getContractFiles,
  getContractDraft,
  listContracts,
  listFixedRentRebates,
  previewFixedContract,
  rejectFixedRentRebate,
  submitFixedRentRebate,
  toContractPayload,
  updateContractDraft,
  uploadContractFile,
} from '../../services/contracts'
import { http } from '../../services/http'
import { paymentApi } from '../../services/payments'
import { useSessionStore } from '../../stores/session'
import {
  emptyContractForm,
  type ContractDetail,
  type ContractFile,
  type ContractFormModel,
  type ContractListItem,
  type ContractPayload,
  type ContractPreview,
  type ContractRoom,
  type ContractTenant,
  type ContractWorkspaceTab,
  type PricingRebate,
  type RentBill,
} from '../../types/contracts'
import type { PaymentListItem } from '../../types/payments'

type ApiResponse<T> = { data: T }
const draftStorageKey = 'srms.currentFixedContractDraftId'

const route = useRoute()
const router = useRouter()
const session = useSessionStore()
const role = session.user?.role || 'VISITOR'
const tab = ref<ContractWorkspaceTab>('list')
const rooms = ref<ContractRoom[]>([])
const tenants = ref<ContractTenant[]>([])
const contracts = ref<ContractListItem[]>([])
const selectedContractId = ref<number | null>(null)
const selectedContract = ref<ContractDetail | null>(null)
const bills = ref<RentBill[]>([])
const files = ref<ContractFile[]>([])
const changes = ref<unknown[]>([])
const rebates = ref<PricingRebate[]>([])
const payments = ref<PaymentListItem[]>([])
const form = ref<ContractFormModel>(emptyContractForm())
const preview = ref<ContractPreview | null>(null)
const previewLoading = ref(false)
const loading = ref(false)
const saving = ref(false)
const currentDraftId = ref<number | null>(null)
let previewTimer: ReturnType<typeof setTimeout> | null = null
const previewRequests = createLatestRequestGuard()
let baseDataLoaded = false

const workspaceTabs: ContractWorkspaceTab[] = ['list', 'create', 'detail', 'fixed-rebate']

function tabFromRoute(): ContractWorkspaceTab | null {
  const value = route.query.tab
  return typeof value === 'string' && workspaceTabs.includes(value as ContractWorkspaceTab)
    ? value as ContractWorkspaceTab
    : null
}

function contractIdFromRoute(): number | null {
  const value = Number(route.query.contractId)
  return Number.isInteger(value) && value > 0 ? value : null
}

async function writeWorkspaceRoute(nextTab: ContractWorkspaceTab, contractId = selectedContractId.value) {
  if (route.name !== 'contracts') return
  const query = { ...route.query, tab: nextTab } as Record<string, string | string[] | undefined>
  if (contractId) query.contractId = String(contractId)
  else delete query.contractId
  await router.replace({ name: 'contracts', query })
}

function setTab(nextTab: ContractWorkspaceTab) {
  tab.value = nextTab
  void writeWorkspaceRoute(nextTab)
}

const errorMessage = (error: unknown, fallback: string) => {
  const response = (error as { response?: { data?: { message?: string | string[] } } })?.response
  const message = response?.data?.message
  return Array.isArray(message) ? message.join('；') : message || fallback
}

const formFromPayload = (payload: ContractPayload): ContractFormModel => {
  const empty = emptyContractForm()
  return {
    ...empty,
    ...payload,
    roomId: payload.roomId ?? null,
    primaryTenantId: payload.primaryTenantId ?? null,
    secondaryTenantIds: payload.secondaryTenantIds ?? [],
    concessions: payload.concessions ?? [],
    fileAssetIds: payload.fileAssetIds ?? [],
    commission: payload.commission ?? empty.commission,
  }
}

async function loadBaseData() {
  loading.value = true
  try {
    const [roomResponse, tenantResponse, contractData] = await Promise.all([
      http.get<ApiResponse<ContractRoom[]>>('/properties/rooms'),
      http.get<ApiResponse<{ items: ContractTenant[] }>>('/tenants'),
      listContracts(),
    ])
    rooms.value = roomResponse.data.data.filter((room) => !['SOLD', 'FOR_SALE', 'DISABLED'].includes(room.roomStatus || ''))
    tenants.value = tenantResponse.data.data.items
    contracts.value = contractData
    const roomId = Number(route.query.roomId)
    if (!roomId) {
      const storedDraftId = Number(localStorage.getItem(draftStorageKey))
      if (storedDraftId) {
        try {
          const draft = await getContractDraft(storedDraftId)
          if (draft.status === 'DRAFT') {
            currentDraftId.value = draft.id
            form.value = formFromPayload(draft.payload)
          } else localStorage.removeItem(draftStorageKey)
        } catch {
          localStorage.removeItem(draftStorageKey)
        }
      }
    }
    if (roomId && rooms.value.some((room) => room.id === roomId)) {
      form.value.roomId = roomId
      const existing = contracts.value.find((contract) => contract.roomId === roomId && contract.pricingMode === 'FIXED')
      if (existing) await selectContract(existing)
      else tab.value = 'create'
    }
    baseDataLoaded = true
    await applyRouteState()
  } catch (error) {
    ElMessage.error(errorMessage(error, '合同工作区加载失败'))
  } finally {
    loading.value = false
  }
}

async function selectContract(summary: ContractListItem, syncRoute = true) {
  selectedContractId.value = summary.id
  loading.value = true
  try {
    const [detail, contractBills, contractFiles, contractChanges, contractRebates, contractPayments] = await Promise.all([
      getContract(summary.id),
      getContractBills(summary.id),
      getContractFiles(summary.id),
      getContractChanges(summary.id),
      listFixedRentRebates(summary.id),
      paymentApi.list({ contractId: summary.id }),
    ])
    selectedContract.value = { ...detail, room: summary.room }
    bills.value = contractBills
    files.value = contractFiles
    changes.value = contractChanges
    rebates.value = contractRebates
    payments.value = contractPayments
    tab.value = 'detail'
    if (syncRoute) await writeWorkspaceRoute('detail', summary.id)
  } catch (error) {
    ElMessage.error(errorMessage(error, '合同详情加载失败'))
  } finally {
    loading.value = false
  }
}

function startCreate() {
  currentDraftId.value = null
  localStorage.removeItem(draftStorageKey)
  form.value = emptyContractForm()
  preview.value = null
  setTab('create')
}

async function applyRouteState() {
  if (!baseDataLoaded) return
  const routeContractId = contractIdFromRoute()
  if (routeContractId && routeContractId !== selectedContractId.value) {
    const summary = contracts.value.find((item) => item.id === routeContractId)
    if (summary) await selectContract(summary, false)
  }
  const routeTab = tabFromRoute()
  if (routeTab) tab.value = routeTab
  else if (routeContractId && selectedContractId.value === routeContractId) tab.value = 'detail'
}

async function saveDraft(payload: ContractPayload) {
  saving.value = true
  try {
    const draft = currentDraftId.value
      ? await updateContractDraft(currentDraftId.value, payload)
      : await createContractDraft(payload)
    currentDraftId.value = draft.id
    localStorage.setItem(draftStorageKey, String(draft.id))
    ElMessage.success('合同草稿已保存')
  } catch (error) {
    ElMessage.error(errorMessage(error, '保存草稿失败，已填写内容仍保留在页面'))
  } finally {
    saving.value = false
  }
}

async function confirm(payload: ContractPayload) {
  saving.value = true
  try {
    let contract: ContractListItem
    if (currentDraftId.value) {
      await updateContractDraft(currentDraftId.value, payload)
      contract = await confirmContractDraft(currentDraftId.value)
    } else {
      contract = await confirmFixedContract(payload)
    }
    ElMessage.success('合同已确认并生成账单')
    contracts.value = await listContracts()
    const summary = contracts.value.find((item) => item.id === contract.id) || contract
    currentDraftId.value = null
    localStorage.removeItem(draftStorageKey)
    await selectContract(summary)
  } catch (error) {
    ElMessage.error(errorMessage(error, '合同确认失败，请检查填写内容'))
  } finally {
    saving.value = false
  }
}

async function uploadFile(file: File) {
  try {
    const asset = await uploadContractFile(file)
    if (!form.value.fileAssetIds.includes(asset.id)) form.value.fileAssetIds.push(asset.id)
    ElMessage.success(`附件“${asset.originalName}”上传成功`)
  } catch (error) {
    ElMessage.error(errorMessage(error, '合同附件上传失败，可单独重试'))
  }
}

async function downloadFile(file: ContractFile) {
  if (!selectedContractId.value) return
  try {
    const blob = await downloadContractFile(selectedContractId.value, file.id)
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = file.originalName.replace(/[\\/:*?"<>|]/g, '_')
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
  } catch (error) {
    ElMessage.error(errorMessage(error, '合同附件下载失败，请稍后重试'))
  }
}

async function loadPreview(generation: number) {
  const payload = toContractPayload(form.value, role)
  if (!payload.startDate || !payload.endDate || payload.endDate < payload.startDate || payload.monthlyRent === undefined || Number(payload.monthlyRent) < 0) {
    if (previewRequests.isCurrent(generation)) {
      preview.value = null
      previewLoading.value = false
    }
    return
  }
  if (previewRequests.isCurrent(generation)) previewLoading.value = true
  try {
    const result = await previewFixedContract(payload)
    if (previewRequests.isCurrent(generation)) preview.value = result
  } catch {
    if (previewRequests.isCurrent(generation)) preview.value = null
  } finally {
    if (previewRequests.isCurrent(generation)) previewLoading.value = false
  }
}

watch(
  () => [form.value.startDate, form.value.endDate, form.value.monthlyRent, JSON.stringify(form.value.concessions)],
  () => {
    const generation = previewRequests.next()
    preview.value = null
    previewLoading.value = false
    if (previewTimer) clearTimeout(previewTimer)
    previewTimer = setTimeout(() => loadPreview(generation), 300)
  },
)

async function selectRebateContract(id: number) {
  const summary = contracts.value.find((item) => item.id === id && item.status === 'ACTIVE' && item.pricingMode === 'FIXED')
  if (!summary) {
    ElMessage.warning('请选择履行中的固定月租合同')
    return
  }
  await selectContract(summary, false)
  setTab('fixed-rebate')
}

async function submitRebate(payload: Record<string, unknown>) {
  saving.value = true
  try {
    if (!selectedContract.value) throw new Error('请先选择合同')
    await submitFixedRentRebate(selectedContract.value, payload)
    rebates.value = await listFixedRentRebates(selectedContractId.value || undefined)
    ElMessage.success('固定月租退差申请已提交')
  } catch (error) {
    ElMessage.error(errorMessage(error, '退差申请提交失败'))
  } finally {
    saving.value = false
  }
}

async function approveRebate(id: number) {
  try {
    await approveFixedRentRebate(id)
    rebates.value = await listFixedRentRebates(selectedContractId.value || undefined)
    ElMessage.success('退差已确认')
  } catch (error) { ElMessage.error(errorMessage(error, '退差确认失败')) }
}

async function rejectRebate(id: number) {
  try {
    const result = await ElMessageBox.prompt('请输入驳回原因', '驳回退差', { confirmButtonText: '确认驳回', cancelButtonText: '取消', inputValidator: (value) => Boolean(value.trim()) || '请输入驳回原因' })
    await rejectFixedRentRebate(id, result.value)
    rebates.value = await listFixedRentRebates(selectedContractId.value || undefined)
    ElMessage.success('退差已驳回')
  } catch (error) {
    if (error !== 'cancel') ElMessage.error(errorMessage(error, '退差驳回失败'))
  }
}

onMounted(loadBaseData)
onBeforeUnmount(() => { if (previewTimer) clearTimeout(previewTimer) })
watch(() => [route.query.tab, route.query.contractId], () => void applyRouteState())
</script>

<template>
  <el-config-provider :locale="zhCn">
    <main class="contracts-workspace">
      <ContractTopNav :model-value="tab" :selected-contract-id="selectedContractId" @update:model-value="setTab" />
      <ContractListPanel v-if="tab === 'list'" :contracts="contracts" :selected-contract-id="selectedContractId" :draft-id="currentDraftId" :loading="loading" @select="selectContract" @create="startCreate" @continue-draft="setTab('create')" />
      <div v-else-if="tab === 'create'" class="create-grid">
        <ContractFormPanel v-model="form" :role="role" :rooms="rooms" :tenants="tenants" :saving="saving" @save-draft="saveDraft" @confirm="confirm" @cancel="setTab('list')" @upload-file="uploadFile" />
        <ContractSummaryPanel :form="form" :rooms="rooms" :tenants="tenants" :role="role" :preview="preview" :preview-loading="previewLoading" />
      </div>
      <ContractDetailPanel v-else-if="tab === 'detail'" :contract="selectedContract" :bills="bills" :files="files" :changes="changes" :payments="payments" :role="role" :loading="loading" @back="setTab('list')" @rebate="setTab('fixed-rebate')" @download="downloadFile" />
      <FixedRentRebatePanel v-else :contract="selectedContract" :contracts="contracts" :bills="bills" :rebates="rebates" :role="role" :saving="saving" @back="setTab('list')" @select-contract="selectRebateContract" @submit="submitRebate" @approve="approveRebate" @reject="rejectRebate" />
    </main>
  </el-config-provider>
</template>

<style scoped>
.contracts-workspace { min-height: 100%; padding: 20px 26px 40px; color: #233044; font: 14px/1.5 "Microsoft YaHei", "PingFang SC", sans-serif; background: #f3f6fb; }
.create-grid { display: grid; grid-template-columns: minmax(0, 1fr) 340px; gap: 15px; align-items: start; }
@media (max-width: 1100px) { .create-grid { grid-template-columns: minmax(0, 1fr); } }
@media (max-width: 760px) { .contracts-workspace { padding: 12px 10px 28px; } }
</style>
