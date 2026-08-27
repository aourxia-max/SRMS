<script setup lang="ts">
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import { ElMessage, ElMessageBox } from 'element-plus'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import ContractDetailPanel from '../../components/contracts/ContractDetailPanel.vue'
import ContractFormPanel from '../../components/contracts/ContractFormPanel.vue'
import ContractListPanel from '../../components/contracts/ContractListPanel.vue'
import ContractSummaryPanel from '../../components/contracts/ContractSummaryPanel.vue'
import ContractTopNav from '../../components/contracts/ContractTopNav.vue'
import FixedRentRebatePanel from '../../components/contracts/FixedRentRebatePanel.vue'
import ContractVoidPanel from '../../components/contracts/voids/ContractVoidPanel.vue'
import { appendContractFile, approveFixedRentRebate, confirmContractDraft, confirmFixedContract, createContractDraft, createLatestRequestGuard, downloadContractFile, isFixedRentRebateEligible, getContract, getContractBills, getContractChanges, getContractFiles, getContractDraft, listContracts, listFixedRentRebates, previewFixedContract, rejectFixedRentRebate, submitFixedRentRebate, toContractPayload, updateContractDraft, uploadContractFile } from '../../services/contracts'
import { http } from '../../services/http'
import { listAllPayments } from '../../services/payments'
import { useSessionStore } from '../../stores/session'
import { emptyContractForm, type ContractDetail, type ContractChange, type ContractFile, type ContractFormModel, type ContractListItem, type ContractPayload, type ContractPreview, type ContractRoom, type ContractTenant, type ContractWorkspaceTab, type PricingRebate, type RentBill } from '../../types/contracts'
import type { PaymentListItem } from '../../types/payments'

type ApiResponse<T> = { data: T }
const draftStorageKey = 'srms.currentFixedContractDraftId'

const route = useRoute()
const router = useRouter()
const session = useSessionStore()
const role = session.user?.role || 'VISITOR'
const canAccessVoidCorrection = role === 'ADMIN' || role === 'SUPER_ADMIN'
const tab = ref<ContractWorkspaceTab>('list')
const rooms = ref<ContractRoom[]>([])
const tenants = ref<ContractTenant[]>([])
const contracts = ref<ContractListItem[]>([])
const selectedContractId = ref<number | null>(null)
const selectedContract = ref<ContractDetail | null>(null)
const bills = ref<RentBill[]>([])
const files = ref<ContractFile[]>([])
const changes = ref<ContractChange[]>([])
const rebates = ref<PricingRebate[]>([])
const payments = ref<PaymentListItem[]>([])
const form = ref<ContractFormModel>(emptyContractForm())
const preview = ref<ContractPreview | null>(null)
const fixedPreviewLoading = ref(false)
const previewOpen = ref(false)
const previewLoading = ref(false)
const previewUrl = ref('')
const previewName = ref('')
const previewScale = ref(1)
const previewScaleLabel = computed(() => Math.round(previewScale.value * 100) + '%')
const loading = ref(false)
const saving = ref(false)
const currentDraftId = ref<number | null>(null)
let previewTimer: ReturnType<typeof setTimeout> | null = null
const previewRequests = createLatestRequestGuard()
let previewRequest = 0
let baseDataLoaded = false

const workspaceTabs: ContractWorkspaceTab[] = ['list', 'create', 'detail', 'fixed-rebate', 'void-correction']

function tabFromRoute(): ContractWorkspaceTab | null {
  const value = route.query.tab
  return typeof value === 'string' && workspaceTabs.includes(value as ContractWorkspaceTab) ? (value as ContractWorkspaceTab) : null
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
  if (nextTab === 'void-correction' && !canAccessVoidCorrection) return
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
    const [roomResponse, tenantResponse, contractData] = await Promise.all([http.get<ApiResponse<ContractRoom[]>>('/properties/rooms'), http.get<ApiResponse<{ items: ContractTenant[] }>>('/tenants'), listContracts()])
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
      tab.value = 'list'
    }
    baseDataLoaded = true
    await applyRouteState()
  } catch (error) {
    ElMessage.error(errorMessage(error, '合同工作区加载失败'))
  } finally {
    loading.value = false
  }
}

let detailLoadGeneration = 0

function clearSelectedContract() {
  detailLoadGeneration += 1
  selectedContractId.value = null
  selectedContract.value = null
  bills.value = []
  files.value = []
  changes.value = []
  rebates.value = []
  payments.value = []
}

async function selectContract(summary: ContractListItem, syncRoute = true, failClosed = false) {
  const generation = ++detailLoadGeneration
  selectedContractId.value = summary.id
  loading.value = true
  try {
    const [detail, contractBills, contractFiles, contractChanges, contractRebates, contractPayments] = await Promise.all([getContract(summary.id), getContractBills(summary.id), getContractFiles(summary.id), getContractChanges(summary.id), listFixedRentRebates(summary.id), listAllPayments({ contractId: summary.id })])
    if (generation !== detailLoadGeneration || selectedContractId.value !== summary.id) return false
    selectedContract.value = { ...detail, room: summary.room }
    bills.value = contractBills
    files.value = contractFiles
    changes.value = contractChanges
    rebates.value = contractRebates
    payments.value = contractPayments
    tab.value = 'detail'
    if (syncRoute) await writeWorkspaceRoute('detail', summary.id)
    return true
  } catch (error) {
    if (generation !== detailLoadGeneration) return false
    if (failClosed) {
      clearSelectedContract()
      throw error
    }
    ElMessage.error(errorMessage(error, '合同详情加载失败'))
    return false
  } finally {
    if (generation === detailLoadGeneration) loading.value = false
  }
}

function startCreate() {
  currentDraftId.value = null
  localStorage.removeItem(draftStorageKey)
  const nextForm = emptyContractForm()
  const routeRoomId = Number(route.query.roomId)
  if (rooms.value.some((room) => room.id === routeRoomId)) nextForm.roomId = routeRoomId
  form.value = nextForm
  preview.value = null
  setTab('create')
}

async function applyRouteState() {
  if (!baseDataLoaded) return
  const routeContractId = contractIdFromRoute()
  const routeTab = tabFromRoute()
  if (routeTab === 'void-correction' && !canAccessVoidCorrection) {
    tab.value = 'list'
    return
  }
  if (routeTab === 'fixed-rebate') {
    const summary = routeContractId ? contracts.value.find((item) => item.id === routeContractId && isFixedRentRebateEligible(item)) : undefined
    if (summary && routeContractId !== selectedContractId.value) await selectContract(summary, false)
    else if (!summary) {
      selectedContractId.value = null
      selectedContract.value = null
      bills.value = []
      files.value = []
      changes.value = []
      rebates.value = []
      payments.value = []
    }
    tab.value = 'fixed-rebate'
    return
  }

  if (routeContractId && routeContractId !== selectedContractId.value) {
    const summary = contracts.value.find((item) => item.id === routeContractId)
    if (summary) await selectContract(summary, false)
  }
  if (routeTab) tab.value = routeTab
  else if (routeContractId && selectedContractId.value === routeContractId) tab.value = 'detail'
}

async function saveDraft(payload: ContractPayload) {
  saving.value = true
  try {
    const draft = currentDraftId.value ? await updateContractDraft(currentDraftId.value, payload) : await createContractDraft(payload)
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

async function appendSelectedContractFile(file: File) {
  if (!selectedContractId.value) return
  saving.value = true
  try {
    const asset = await appendContractFile(selectedContractId.value, file)
    files.value = await getContractFiles(selectedContractId.value)
    ElMessage.success(`附件“${asset.originalName}”已添加，历史附件仍保留`)
  } catch (error) {
    ElMessage.error(errorMessage(error, '合同附件上传失败，请检查文件后重试'))
  } finally {
    saving.value = false
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

function releasePreviewUrl() {
  if (previewUrl.value) URL.revokeObjectURL(previewUrl.value)
  previewUrl.value = ''
}

async function previewFile(file: ContractFile) {
  if (!selectedContractId.value) return
  const request = ++previewRequest
  releasePreviewUrl()
  previewScale.value = 1
  previewLoading.value = true
  previewName.value = file.originalName
  previewOpen.value = true
  try {
    const blob = await downloadContractFile(selectedContractId.value, file.id)
    const url = URL.createObjectURL(blob)
    if (request !== previewRequest) {
      URL.revokeObjectURL(url)
      return
    }
    previewUrl.value = url
  } catch (error) {
    if (request === previewRequest) {
      previewOpen.value = false
      releasePreviewUrl()
      ElMessage.error(errorMessage(error, '合同附件预览失败，请稍后重试'))
    }
  } finally {
    if (request === previewRequest) previewLoading.value = false
  }
}

function changePreviewScale(delta: number) {
  previewScale.value = Math.min(3, Math.max(0.5, Number((previewScale.value + delta).toFixed(2))))
}

function resetPreviewScale() {
  previewScale.value = 1
}

function closePreview() {
  previewRequest += 1
  previewOpen.value = false
  previewName.value = ''
  resetPreviewScale()
  releasePreviewUrl()
}
async function loadPreview(generation: number) {
  const payload = toContractPayload(form.value, role)
  if (!payload.startDate || !payload.endDate || payload.endDate < payload.startDate || payload.monthlyRent === undefined || Number(payload.monthlyRent) < 0) {
    if (previewRequests.isCurrent(generation)) {
      preview.value = null
      fixedPreviewLoading.value = false
    }
    return
  }
  if (previewRequests.isCurrent(generation)) fixedPreviewLoading.value = true
  try {
    const result = await previewFixedContract(payload)
    if (previewRequests.isCurrent(generation)) preview.value = result
  } catch {
    if (previewRequests.isCurrent(generation)) preview.value = null
  } finally {
    if (previewRequests.isCurrent(generation)) fixedPreviewLoading.value = false
  }
}

watch(
  () => [form.value.startDate, form.value.endDate, form.value.monthlyRent, JSON.stringify(form.value.concessions)],
  () => {
    const generation = previewRequests.next()
    preview.value = null
    fixedPreviewLoading.value = false
    if (previewTimer) clearTimeout(previewTimer)
    previewTimer = setTimeout(() => loadPreview(generation), 300)
  },
)

async function selectRebateContract(id: number) {
  const summary = contracts.value.find((item) => item.id === id && isFixedRentRebateEligible(item))
  if (!summary) {
    ElMessage.warning('请选择履行中的固定月租合同')
    return
  }
  await selectContract(summary, false)
  setTab('fixed-rebate')
}

async function openFixedRentRebate(contractId: number) {
  await selectRebateContract(contractId)
}

function openCheckout(contractId: number) {
  void router.push({
    name: 'checkout',
    query: { tab: 'initiate', contractId: String(contractId) },
  })
}

function openPaymentCollect(contractId: number) {
  void router.push({
    path: '/payments/collect',
    query: { contractId: String(contractId) },
  })
}

function openContractVoidCorrection(contractId: number) {
  selectedContractId.value = contractId
  setTab('void-correction')
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

async function reloadSelectedContract() {
  const summary = contracts.value.find((item) => item.id === selectedContractId.value)
  if (summary) await selectContract(summary, false)
}

async function handleContractVoidCompleted(contractId: number) {
  clearSelectedContract()
  tab.value = 'list'
  try {
    contracts.value = await listContracts()
    const summary = contracts.value.find((item) => item.id === contractId)
    if (!summary) {
      await writeWorkspaceRoute('list', null)
      return
    }
    await selectContract(summary, false, true)
    await writeWorkspaceRoute('detail', contractId)
  } catch (error) {
    clearSelectedContract()
    tab.value = 'list'
    await writeWorkspaceRoute('list', null)
    ElMessage.error(errorMessage(error, '合同作废后详情刷新失败，请手动刷新'))
  }
}

async function approveRebate(id: number) {
  try {
    await approveFixedRentRebate(id)
    rebates.value = await listFixedRentRebates(selectedContractId.value || undefined)
    ElMessage.success('退差已确认')
  } catch (error) {
    ElMessage.error(errorMessage(error, '退差确认失败'))
  }
}

async function rejectRebate(id: number) {
  try {
    const result = await ElMessageBox.prompt('请输入驳回原因', '驳回退差', {
      confirmButtonText: '确认驳回',
      cancelButtonText: '取消',
      inputValidator: (value) => Boolean(value.trim()) || '请输入驳回原因',
    })
    await rejectFixedRentRebate(id, result.value)
    rebates.value = await listFixedRentRebates(selectedContractId.value || undefined)
    ElMessage.success('退差已驳回')
  } catch (error) {
    if (error !== 'cancel') ElMessage.error(errorMessage(error, '退差驳回失败'))
  }
}

onMounted(loadBaseData)
onBeforeUnmount(() => {
  if (previewTimer) clearTimeout(previewTimer)
  closePreview()
})
watch(
  () => [route.query.tab, route.query.contractId],
  () => void applyRouteState(),
)
</script>

<template>
  <el-config-provider :locale="zhCn">
    <main class="contracts-workspace">
      <ContractTopNav :model-value="tab" :selected-contract-id="selectedContractId" :role="role" @update:model-value="setTab" />
      <ContractListPanel v-if="tab === 'list'" :contracts="contracts" :selected-contract-id="selectedContractId" :draft-id="currentDraftId" :loading="loading" :initial-room-id="Number(route.query.roomId) || null" @select="selectContract" @create="startCreate" @continue-draft="setTab('create')" />
      <div v-else-if="tab === 'create'" class="create-grid">
        <ContractFormPanel v-model="form" :role="role" :rooms="rooms" :tenants="tenants" :saving="saving" @save-draft="saveDraft" @confirm="confirm" @cancel="setTab('list')" @upload-file="uploadFile" />
        <ContractSummaryPanel :form="form" :rooms="rooms" :tenants="tenants" :role="role" :preview="preview" :preview-loading="fixedPreviewLoading" />
      </div>
      <ContractDetailPanel v-else-if="tab === 'detail'" :contract="selectedContract" :bills="bills" :files="files" :changes="changes" :payments="payments" :role="role" :loading="loading" @back="setTab('list')" @rebate="openFixedRentRebate" @checkout="openCheckout" @payment="openPaymentCollect" @void-correction="openContractVoidCorrection" @preview="previewFile" @download="downloadFile" @upload="appendSelectedContractFile" @commission-changed="reloadSelectedContract" />
      <FixedRentRebatePanel v-else-if="tab === 'fixed-rebate'" :contract="selectedContract" :contracts="contracts" :bills="bills" :rebates="rebates" :role="role" :saving="saving" @back="setTab('list')" @select-contract="selectRebateContract" @submit="submitRebate" @approve="approveRebate" @reject="rejectRebate" />
      <ContractVoidPanel v-else-if="tab === 'void-correction' && canAccessVoidCorrection" :contracts="contracts" :role="role" :current-user-id="session.user?.id ?? null" :selected-contract-id="selectedContractId" @completed="handleContractVoidCompleted" />
    </main>
    <el-dialog v-model="previewOpen" :title="previewName || '合同附件预览'" width="880px" @closed="closePreview">
      <el-skeleton v-if="previewLoading" :rows="6" animated />
      <div v-else-if="previewUrl" class="contract-preview-viewer">
        <div class="contract-preview-toolbar" aria-label="图片缩放控制">
          <el-button data-test="contract-preview-zoom-out" :disabled="previewScale <= 0.5" @click="changePreviewScale(-0.25)">缩小</el-button>
          <span data-test="contract-preview-scale">{{ previewScaleLabel }}</span>
          <el-button data-test="contract-preview-zoom-in" :disabled="previewScale >= 3" @click="changePreviewScale(0.25)">放大</el-button>
          <el-button data-test="contract-preview-reset" @click="resetPreviewScale">重置</el-button>
        </div>
        <div class="contract-preview-viewport">
          <img data-test="contract-image-preview" :src="previewUrl" :alt="previewName" class="contract-image-preview" :style="{ transform: 'scale(' + previewScale + ')' }" />
        </div>
      </div>
    </el-dialog>
  </el-config-provider>
</template>

<style scoped>
.contracts-workspace {
  min-height: 100%;
  padding: 20px 26px 40px;
  color: #233044;
  font:
    14px/1.5 'Microsoft YaHei',
    'PingFang SC',
    sans-serif;
  background: #f3f6fb;
}
.create-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 340px;
  gap: 15px;
  align-items: start;
}
@media (max-width: 1100px) {
  .create-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
@media (max-width: 760px) {
  .contracts-workspace {
    padding: 12px 10px 28px;
  }
}
.contract-preview-viewer {
  display: grid;
  gap: 12px;
}
.contract-preview-toolbar {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
}
.contract-preview-toolbar span {
  min-width: 48px;
  color: #526075;
  font-variant-numeric: tabular-nums;
  text-align: center;
}
.contract-preview-viewport {
  display: flex;
  min-height: 260px;
  max-height: 65vh;
  align-items: flex-start;
  justify-content: center;
  padding: 16px;
  overflow: auto;
  background: #f3f6fb;
  border-radius: 8px;
}
.contract-image-preview {
  display: block;
  max-width: 100%;
  max-height: 58vh;
  margin: 0 auto;
  object-fit: contain;
  transform-origin: top center;
  transition: transform 120ms ease;
}
</style>
