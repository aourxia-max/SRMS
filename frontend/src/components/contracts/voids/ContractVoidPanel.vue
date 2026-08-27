<script setup lang="ts">
import { ElMessage, ElMessageBox } from 'element-plus'
import type { ElMessageBoxOptions, UploadFile } from 'element-plus'
import { computed, h, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { approveContractVoidRequest, cancelContractVoidRequest, deleteContractVoidProof, downloadContractVoidProof, getContractVoidRequest, listContractVoidRequests, previewContractVoid, refreshContractVoidRequestSnapshot, rejectContractVoidRequest, submitContractVoidRequest, uploadContractVoidProof } from '../../../services/contracts'
import type { ContractListItem, ContractRole, ContractVoidImpact, ContractVoidProofFile, ContractVoidRequest, ContractVoidRequestQuery, ContractVoidRequestStatus } from '../../../types/contracts'
import { contractVoidConfirmationText } from '../../../types/contracts'
import { contractVoidCategoryLabel, contractVoidSourceLabel, contractVoidStatusLabel } from './contract-void-presentation'
import { createContractVoidActionSession } from './contract-void-action-session'
import ContractVoidImpactCards from './ContractVoidImpactCards.vue'

const props = withDefaults(
  defineProps<{
    contracts: ContractListItem[]
    role: ContractRole
    selectedContractId?: number | null
    currentUserId?: number | null
  }>(),
  { selectedContractId: null, currentUserId: null },
)

const emit = defineEmits<{
  completed: [contractId: number]
}>()

type UploadedProof = ContractVoidProofFile & { previewUrl: string }
type PreviewFile = {
  id: number
  originalName: string
  mimeType: string
  previewUrl: string
}

type ActionSession = ReturnType<typeof createContractVoidActionSession>
const requests = ref<ContractVoidRequest[]>([])
const requestsLoading = ref(false)
const detailLoading = ref(false)
const impactLoading = ref(false)
const saving = ref(false)
const attachmentUploading = ref(false)
const selectedId = ref<number | null>(null)
const impact = ref<ContractVoidImpact | null>(null)
const selectedRequest = ref<ContractVoidRequest | null>(null)
const reason = ref('')
const uploadedProofs = ref<UploadedProof[]>([])
const contractKeyword = ref('')
const previewOpen = ref(false)
const previewFile = ref<PreviewFile | null>(null)
const previewOwnedUrl = ref(false)
const filters = reactive<{
  contractNo: string
  roomKeyword: string
  tenantKeyword: string
  status: ContractVoidRequestStatus | ''
}>({ contractNo: '', roomKeyword: '', tenantKeyword: '', status: '' })
let previewGeneration = 0
let authGeneration = 0
const authReady = computed(() => Number.isInteger(props.currentUserId) && Number(props.currentUserId) > 0 && (props.role === 'ADMIN' || props.role === 'SUPER_ADMIN'))
let actionSession: ActionSession | null = authReady.value ? createContractVoidActionSession(props.currentUserId!) : null
let activeFormContractId: number | null = null
let activePromptClose: (() => void) | null = null

const eligibleContracts = computed(() => props.contracts.filter((item) => item.status !== 'VOIDED'))
const visibleContracts = computed(() => {
  const keyword = contractKeyword.value.trim().toLocaleLowerCase('zh-CN')
  if (!keyword) return eligibleContracts.value
  return eligibleContracts.value.filter((item) => contractOptionLabel(item).toLocaleLowerCase('zh-CN').includes(keyword))
})
const selectedContract = computed(() => props.contracts.find((item) => item.id === selectedId.value) ?? null)
const terminalRequest = computed(() => Boolean(selectedRequest.value && selectedRequest.value.status !== 'PENDING'))
const canCancelRequest = computed(() => selectedRequest.value?.status === 'PENDING' && (props.role === 'SUPER_ADMIN' || selectedRequest.value.submittedBy === props.currentUserId))
const submitDisabled = computed(() => !authReady.value || !actionSession || saving.value || attachmentUploading.value || !selectedContract.value || selectedContract.value.status === 'VOIDED' || !impact.value?.impactHash || !reason.value.trim())
const selectedRequestImpact = computed<ContractVoidImpact | null>(() =>
  selectedRequest.value
    ? {
        ...selectedRequest.value.impactSnapshot,
        impactHash: selectedRequest.value.impactHash,
      }
    : null,
)

function isCurrentAuthContext(generation: number) {
  return generation === authGeneration && authReady.value && Boolean(actionSession)
}

function primaryTenant(contract?: ContractListItem | ContractVoidRequest['contract'] | null) {
  return contract?.members?.find((item) => item.memberRole === 'PRIMARY')?.tenant.name || '未记录租户'
}

function contractOptionLabel(contract: ContractListItem) {
  return [contract.contractNo, contract.room?.fullHouseNo || `房源${contract.roomId}`, primaryTenant(contract)].filter((value, index, items) => !items.slice(0, index).some((previous) => previous.includes(value))).join('｜')
}

function date(value?: string | null) {
  return value ? String(value).slice(0, 10) : '—'
}

function exactMoney(value?: string | null) {
  if (!value) return '—'
  const match = /^(-?)(\d+)(\.\d+)?$/.exec(value)
  if (!match) return '金额格式异常'
  return `${match[1]}¥${match[2].replace(/\B(?=(\d{3})+(?!\d))/g, ',')}${match[3] ?? ''}`
}

function statusTagType(status?: string | null): 'warning' | 'success' | 'danger' | 'info' {
  if (status === 'PENDING') return 'warning'
  if (status === 'COMPLETED') return 'success'
  if (status === 'REJECTED') return 'danger'
  return 'info'
}

function errorDetails(error: unknown, fallback: string) {
  const response = (
    error as {
      response?: {
        status?: number
        data?: { code?: number; message?: string | string[] }
      }
    }
  )?.response
  const raw = response?.data?.message
  return {
    code: response?.data?.code ?? response?.status,
    message: Array.isArray(raw) ? raw.join('；') : raw || fallback,
  }
}

function isStale(error: unknown) {
  const detail = errorDetails(error, '')
  return (detail.code === 400 && detail.message === '合同关联数据已变化，请重新预览') || (detail.code === 409 && detail.message === '合同关联审批状态已并发变化，请重新预览')
}

function isPromptCancelled(error: unknown) {
  return error === 'cancel' || error === 'close'
}

function closePanelPrompt() {
  const close = activePromptClose
  activePromptClose = null
  close?.()
}

async function promptOwnedByPanel(message: string, title: string, options: ElMessageBoxOptions) {
  let ownedClose: (() => void) | null = null
  try {
    return await ElMessageBox.prompt(
      ({ close }) => {
        ownedClose = close
        activePromptClose = close
        return h('span', message)
      },
      title,
      options,
    )
  } finally {
    if (activePromptClose === ownedClose) activePromptClose = null
  }
}

function queryFromFilters(): ContractVoidRequestQuery {
  return {
    ...(filters.contractNo.trim() ? { contractNo: filters.contractNo.trim() } : {}),
    ...(filters.roomKeyword.trim() ? { roomKeyword: filters.roomKeyword.trim() } : {}),
    ...(filters.tenantKeyword.trim() ? { tenantKeyword: filters.tenantKeyword.trim() } : {}),
    ...(filters.status ? { status: filters.status } : {}),
  }
}

async function recoverPendingRequest(rows: ContractVoidRequest[], submissionKey: string | undefined, generation: number, session: ActionSession) {
  if (!isCurrentAuthContext(generation) || selectedRequest.value) return null
  const recovered = rows.find(
    (item) =>
      item.status === 'PENDING' &&
      (submissionKey ? item.submissionIdempotencyKey === submissionKey : session.hasSubmissionKey(item.submissionIdempotencyKey)),
  )
  if (!recovered) return null
  let detail: ContractVoidRequest
  try {
    detail = await getContractVoidRequest(recovered.id)
  } catch {
    detail = recovered
  }
  if (!isCurrentAuthContext(generation) || selectedRequest.value) return null
  selectedRequest.value = detail
  selectedId.value = recovered.contractId
  activeFormContractId = recovered.contractId
  impact.value = null
  return selectedRequest.value
}

async function loadRequests(submissionKey?: string, generation = authGeneration) {
  const session = actionSession
  if (!session || !isCurrentAuthContext(generation)) {
    requests.value = []
    requestsLoading.value = false
    return null
  }
  requestsLoading.value = true
  try {
    const loaded = await listContractVoidRequests(submissionKey && selectedId.value ? { contractId: selectedId.value } : queryFromFilters())
    if (!isCurrentAuthContext(generation)) return null
    requests.value = loaded
    loaded.filter((item) => item.status !== 'PENDING').forEach((item) => session.markTerminal(item.id, item.submissionIdempotencyKey))
    return await recoverPendingRequest(loaded, submissionKey, generation, session)
  } catch (error) {
    if (isCurrentAuthContext(generation)) ElMessage.error(errorDetails(error, '合同作废纠错申请加载失败').message)
    return null
  } finally {
    if (isCurrentAuthContext(generation)) requestsLoading.value = false
  }
}

function releaseUploadedProof(file: UploadedProof) {
  if (previewFile.value?.id === file.id) closeProofPreview()
  URL.revokeObjectURL(file.previewUrl)
  uploadedProofs.value = uploadedProofs.value.filter((item) => item.id !== file.id)
}

async function deleteUploadedProof(file: UploadedProof, generation = authGeneration) {
  if (!isCurrentAuthContext(generation)) return false
  try {
    await deleteContractVoidProof(file.id)
    if (!isCurrentAuthContext(generation)) return false
    releaseUploadedProof(file)
    return true
  } catch (error) {
    if (isCurrentAuthContext(generation)) ElMessage.error(errorDetails(error, '证明附件删除失败，请稍后重试').message)
    return false
  }
}

async function removeUploadedProof(file: UploadedProof) {
  const generation = authGeneration
  if (!isCurrentAuthContext(generation) || saving.value || attachmentUploading.value) return
  attachmentUploading.value = true
  try {
    await deleteUploadedProof(file, generation)
  } finally {
    if (isCurrentAuthContext(generation)) attachmentUploading.value = false
  }
}

async function discardUploadedProofs(generation = authGeneration) {
  if (!isCurrentAuthContext(generation)) return false
  if (!uploadedProofs.value.length) return true
  if (saving.value || attachmentUploading.value) return false
  attachmentUploading.value = true
  let allDeleted = true
  try {
    for (const file of [...uploadedProofs.value]) {
      if (!(await deleteUploadedProof(file, generation))) allDeleted = false
      if (!isCurrentAuthContext(generation)) return false
    }
  } finally {
    if (isCurrentAuthContext(generation)) attachmentUploading.value = false
  }
  return isCurrentAuthContext(generation) && allDeleted
}

function releaseUploadedProofs() {
  uploadedProofs.value.forEach((file) => URL.revokeObjectURL(file.previewUrl))
  uploadedProofs.value = []
}

function closeProofPreview() {
  previewOpen.value = false
  if (previewOwnedUrl.value && previewFile.value?.previewUrl) URL.revokeObjectURL(previewFile.value.previewUrl)
  previewOwnedUrl.value = false
  previewFile.value = null
}

function resetUserBoundState() {
  authGeneration += 1
  previewGeneration += 1
  closePanelPrompt()
  requests.value = []
  requestsLoading.value = false
  detailLoading.value = false
  impactLoading.value = false
  saving.value = false
  attachmentUploading.value = false
  selectedId.value = null
  selectedRequest.value = null
  impact.value = null
  reason.value = ''
  contractKeyword.value = ''
  activeFormContractId = null
  closeProofPreview()
  releaseUploadedProofs()
}

async function loadImpact(contractId: number, authContext = authGeneration) {
  if (!isCurrentAuthContext(authContext)) return
  const generation = ++previewGeneration
  impactLoading.value = true
  impact.value = null
  try {
    const result = await previewContractVoid(contractId)
    if (isCurrentAuthContext(authContext) && generation === previewGeneration) impact.value = result
  } catch (error) {
    if (isCurrentAuthContext(authContext) && generation === previewGeneration) ElMessage.error(errorDetails(error, '合同关联影响预览失败').message)
  } finally {
    if (isCurrentAuthContext(authContext) && generation === previewGeneration) impactLoading.value = false
  }
}

async function chooseContract(contractId: number | null) {
  const generation = authGeneration
  if (!authReady.value || !actionSession) {
    previewGeneration += 1
    activeFormContractId = contractId
    selectedRequest.value = null
    selectedId.value = contractId
    reason.value = ''
    impact.value = null
    impactLoading.value = false
    return
  }
  const previousContractId = activeFormContractId
  if (contractId !== previousContractId && !(await discardUploadedProofs(generation))) {
    if (!isCurrentAuthContext(generation)) return
    selectedId.value = previousContractId
    return
  }
  if (!isCurrentAuthContext(generation)) return
  activeFormContractId = contractId
  selectedRequest.value = null
  selectedId.value = contractId
  reason.value = ''
  if (!contractId) {
    previewGeneration += 1
    impact.value = null
    impactLoading.value = false
    return
  }
  const contract = props.contracts.find((item) => item.id === contractId)
  if (!contract || contract.status === 'VOIDED') {
    impact.value = null
    ElMessage.warning('已作废合同不能再次申请作废')
    return
  }
  await loadImpact(contractId, generation)
}

async function openRequest(row: ContractVoidRequest) {
  const generation = authGeneration
  if (!isCurrentAuthContext(generation) || saving.value) return
  if (!(await discardUploadedProofs(generation)) || !isCurrentAuthContext(generation)) return
  detailLoading.value = true
  try {
    const detail = await getContractVoidRequest(row.id)
    if (!isCurrentAuthContext(generation)) return
    selectedRequest.value = detail
    selectedId.value = detail.contractId
    activeFormContractId = detail.contractId
    impact.value = null
  } catch (error) {
    if (isCurrentAuthContext(generation)) ElMessage.error(errorDetails(error, '合同作废纠错申请详情加载失败').message)
  } finally {
    if (isCurrentAuthContext(generation)) detailLoading.value = false
  }
}

async function startNewRequest() {
  const generation = authGeneration
  if (!isCurrentAuthContext(generation)) return
  const contractId = selectedRequest.value?.contractId ?? selectedId.value
  if (!(await discardUploadedProofs(generation)) || !isCurrentAuthContext(generation)) return
  actionSession!.beginNewForm()
  selectedRequest.value = null
  selectedId.value = contractId
  activeFormContractId = contractId
  reason.value = ''
  if (contractId) await loadImpact(contractId, generation)
}

async function refreshStale(contractId: number, generation = authGeneration) {
  if (!isCurrentAuthContext(generation)) return
  selectedRequest.value = null
  selectedId.value = contractId
  await Promise.all([loadImpact(contractId, generation), loadRequests(undefined, generation)])
  if (isCurrentAuthContext(generation)) ElMessage.warning('合同关联数据已变化，已为你重新计算，请再次核对')
}

async function refreshPendingRequestStale(request: ContractVoidRequest, generation = authGeneration) {
  if (!isCurrentAuthContext(generation)) return
  const refreshed = await refreshContractVoidRequestSnapshot(request.id)
  if (!isCurrentAuthContext(generation)) return
  selectedRequest.value = refreshed
  selectedId.value = refreshed.contractId
  impact.value = null
  await loadRequests(undefined, generation)
  if (isCurrentAuthContext(generation)) ElMessage.warning('合同关联数据已变化，已为你重新计算，请再次核对')
}

async function riskConfirmation(action: '直接执行' | '确认作废') {
  const result = await promptOwnedByPanel(`请输入“${contractVoidConfirmationText}”后${action}`, '合同作废风险确认', {
    confirmButtonText: action,
    cancelButtonText: '取消',
    inputPlaceholder: contractVoidConfirmationText,
    inputValidator: (value) => value === contractVoidConfirmationText || `请输入“${contractVoidConfirmationText}”`,
  })
  return result.value
}

function submissionFingerprint() {
  const value = JSON.stringify({
    contractId: selectedContract.value?.id ?? null,
    reason: reason.value.trim(),
    impactHash: impact.value?.impactHash ?? null,
    fileAssetIds: uploadedProofs.value.map((file) => file.id).sort((left, right) => left - right),
  })
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return `v1-${(hash >>> 0).toString(36)}`
}

async function submit(direct: boolean) {
  if (submitDisabled.value) return
  const generation = authGeneration
  const session = actionSession
  const contract = selectedContract.value
  const currentImpact = impact.value
  if (!session || !contract || !currentImpact || !isCurrentAuthContext(generation)) return
  const submissionReason = reason.value.trim()
  const fileAssetIds = uploadedProofs.value.map((file) => file.id)
  const idempotencyKey = session.submissionKey(submissionFingerprint())
  let createdRequest: ContractVoidRequest | null = null
  saving.value = true
  try {
    const confirmation = direct ? await riskConfirmation('直接执行') : null
    if (!isCurrentAuthContext(generation)) return
    const created = await submitContractVoidRequest({
      contractId: contract.id,
      reason: submissionReason,
      impactHash: currentImpact.impactHash,
      fileAssetIds,
      idempotencyKey,
    })
    if (!isCurrentAuthContext(generation)) return
    createdRequest = created
    selectedRequest.value = created
    impact.value = null
    releaseUploadedProofs()
    if (confirmation) {
      await approveContractVoidRequest(created.id, {
        previewHash: created.impactHash,
        confirmation: contractVoidConfirmationText,
        idempotencyKey: session.executionKey(created.id),
      })
      if (!isCurrentAuthContext(generation)) return
      session.markTerminal(created.id, created.submissionIdempotencyKey)
      session.beginNewForm()
      emit('completed', created.contractId)
      try {
        const detail = await getContractVoidRequest(created.id)
        if (isCurrentAuthContext(generation)) selectedRequest.value = detail
      } catch {
        if (isCurrentAuthContext(generation)) selectedRequest.value = { ...created, status: 'COMPLETED' }
      }
      if (!isCurrentAuthContext(generation)) return
      ElMessage.success('合同已作废并完成纠错冲销')
    } else {
      ElMessage.success('合同作废纠错申请已提交')
    }
    await loadRequests(undefined, generation)
  } catch (error) {
    if (!isCurrentAuthContext(generation)) return
    if (isPromptCancelled(error)) return
    if (!createdRequest) {
      const recovered = await loadRequests(idempotencyKey, generation)
      if (!isCurrentAuthContext(generation)) return
      if (recovered) {
        ElMessage.warning('提交响应未确认，已找回服务端待确认申请')
        return
      }
    }
    if (isStale(error) && createdRequest) {
      await refreshPendingRequestStale(createdRequest, generation)
    } else if (isStale(error) && selectedId.value) {
      await refreshStale(selectedId.value, generation)
    } else {
      const detail = errorDetails(error, direct ? '合同作废直接执行失败' : '合同作废纠错申请提交失败')
      ElMessage.error(createdRequest && direct ? `申请已提交，可在当前详情继续确认；${detail.message}` : detail.message)
    }
  } finally {
    if (isCurrentAuthContext(generation)) saving.value = false
  }
}
async function approveRequest() {
  const generation = authGeneration
  const session = actionSession
  const current = selectedRequest.value
  if (!session || !current || !isCurrentAuthContext(generation) || saving.value || current.status !== 'PENDING' || props.role !== 'SUPER_ADMIN') return
  saving.value = true
  try {
    await riskConfirmation('确认作废')
    if (!isCurrentAuthContext(generation)) return
    await approveContractVoidRequest(current.id, {
      previewHash: current.impactHash,
      confirmation: contractVoidConfirmationText,
      idempotencyKey: session.executionKey(current.id),
    })
    if (!isCurrentAuthContext(generation)) return
    session.markTerminal(current.id, current.submissionIdempotencyKey)
    session.beginNewForm()
    emit('completed', current.contractId)
    try {
      const detail = await getContractVoidRequest(current.id)
      if (isCurrentAuthContext(generation)) selectedRequest.value = detail
    } catch {
      if (isCurrentAuthContext(generation)) selectedRequest.value = { ...current, status: 'COMPLETED' }
    }
    if (!isCurrentAuthContext(generation)) return
    await loadRequests(undefined, generation)
    if (!isCurrentAuthContext(generation)) return
    ElMessage.success('合同作废申请已确认并完成冲销')
  } catch (error) {
    if (!isCurrentAuthContext(generation)) return
    if (isPromptCancelled(error)) return
    if (isStale(error)) await refreshPendingRequestStale(current, generation)
    else {
      const detail = errorDetails(error, '合同作废申请确认失败')
      ElMessage.error(`申请仍为待确认，可继续确认；${detail.message}`)
    }
  } finally {
    if (isCurrentAuthContext(generation)) saving.value = false
  }
}

async function rejectRequest() {
  const generation = authGeneration
  const session = actionSession
  const current = selectedRequest.value
  if (!session || !current || !isCurrentAuthContext(generation) || saving.value || props.role !== 'SUPER_ADMIN' || current.status !== 'PENDING') return
  saving.value = true
  try {
    const result = await promptOwnedByPanel('请输入驳回原因', '驳回合同作废申请', {
      confirmButtonText: '确认驳回',
      cancelButtonText: '取消',
      inputValidator: (value) => Boolean(value.trim()) || '请输入驳回原因',
    })
    if (!isCurrentAuthContext(generation)) return
    const rejected = await rejectContractVoidRequest(current.id, result.value.trim())
    if (!isCurrentAuthContext(generation)) return
    selectedRequest.value = rejected
    session.markTerminal(current.id, current.submissionIdempotencyKey)
    await loadRequests(undefined, generation)
    if (!isCurrentAuthContext(generation)) return
    ElMessage.success('合同作废申请已驳回')
  } catch (error) {
    if (isCurrentAuthContext(generation) && !isPromptCancelled(error)) ElMessage.error(errorDetails(error, '合同作废申请驳回失败').message)
  } finally {
    if (isCurrentAuthContext(generation)) saving.value = false
  }
}

async function cancelRequest() {
  const generation = authGeneration
  const session = actionSession
  const current = selectedRequest.value
  if (!session || !current || !isCurrentAuthContext(generation) || saving.value || !canCancelRequest.value) return
  saving.value = true
  try {
    const cancelled = await cancelContractVoidRequest(current.id)
    if (!isCurrentAuthContext(generation)) return
    selectedRequest.value = cancelled
    session.markTerminal(current.id, current.submissionIdempotencyKey)
    await loadRequests(undefined, generation)
    if (!isCurrentAuthContext(generation)) return
    ElMessage.success('合同作废申请已取消')
  } catch (error) {
    if (isCurrentAuthContext(generation)) ElMessage.error(errorDetails(error, '合同作废申请取消失败').message)
  } finally {
    if (isCurrentAuthContext(generation)) saving.value = false
  }
}

async function uploadProof(uploadFile: UploadFile) {
  const generation = authGeneration
  if (!uploadFile.raw || !isCurrentAuthContext(generation) || saving.value || attachmentUploading.value) return
  const raw = uploadFile.raw
  attachmentUploading.value = true
  try {
    const asset = await uploadContractVoidProof(raw)
    if (!isCurrentAuthContext(generation)) return
    const previewUrl = URL.createObjectURL(raw)
    uploadedProofs.value.push({ ...asset, previewUrl })
    ElMessage.success(`证明附件“${asset.originalName}”上传成功`)
  } catch (error) {
    if (isCurrentAuthContext(generation)) ElMessage.error(errorDetails(error, '证明附件上传失败，请重试').message)
  } finally {
    if (isCurrentAuthContext(generation)) attachmentUploading.value = false
  }
}

function previewUploadedProof(file: UploadedProof) {
  if (!authReady.value) return
  closeProofPreview()
  previewFile.value = file
  previewOwnedUrl.value = false
  previewOpen.value = true
}

async function previewRequestProof(file: NonNullable<ContractVoidRequest['files']>[number]) {
  const generation = authGeneration
  const requestId = selectedRequest.value?.id
  if (!requestId || !isCurrentAuthContext(generation) || saving.value) return
  const local = uploadedProofs.value.find((item) => item.id === file.fileAssetId)
  if (local) {
    previewUploadedProof(local)
    return
  }
  saving.value = true
  try {
    const blob = await downloadContractVoidProof(requestId, file.fileAssetId)
    if (!isCurrentAuthContext(generation)) return
    closeProofPreview()
    previewFile.value = {
      ...file.fileAsset,
      previewUrl: URL.createObjectURL(blob),
    }
    previewOwnedUrl.value = true
    previewOpen.value = true
  } catch (error) {
    if (isCurrentAuthContext(generation)) ElMessage.error(errorDetails(error, '证明附件预览失败，请稍后重试').message)
  } finally {
    if (isCurrentAuthContext(generation)) saving.value = false
  }
}

async function downloadRequestProof(file: NonNullable<ContractVoidRequest['files']>[number]) {
  const generation = authGeneration
  const requestId = selectedRequest.value?.id
  if (!requestId || !isCurrentAuthContext(generation) || saving.value) return
  saving.value = true
  try {
    const blob = await downloadContractVoidProof(requestId, file.fileAssetId)
    if (!isCurrentAuthContext(generation)) return
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = file.fileAsset.originalName.replace(/[\\/:*?"<>|]/g, '_')
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
  } catch (error) {
    if (isCurrentAuthContext(generation)) ElMessage.error(errorDetails(error, '证明附件下载失败，请稍后重试').message)
  } finally {
    if (isCurrentAuthContext(generation)) saving.value = false
  }
}

watch(
  () => [props.currentUserId, props.role] as const,
  ([userId]) => {
    resetUserBoundState()
    actionSession = authReady.value && userId ? createContractVoidActionSession(userId) : null
    if (actionSession) void loadRequests(undefined, authGeneration)
  },
  { flush: 'sync' },
)

watch(
  () => props.selectedContractId,
  (contractId) => {
    if (contractId !== selectedId.value) void chooseContract(contractId)
  },
  { immediate: true },
)
onMounted(() => {
  if (authReady.value) void loadRequests(undefined, authGeneration)
})
onBeforeUnmount(() => {
  authGeneration += 1
  previewGeneration += 1
  actionSession = null
  closePanelPrompt()
  closeProofPreview()
  releaseUploadedProofs()
})
</script>

<template>
  <section data-test="contract-void-panel">
    <header class="page-head">
      <div>
        <h1>合同作废／纠错</h1>
        <p>先核对关联影响，再提交作废申请或执行纠错冲销</p>
      </div>
      <el-button v-if="selectedRequest" :disabled="!authReady || saving" @click="startNewRequest">新建作废申请</el-button>
    </header>

    <div class="void-layout">
      <section class="contract-card request-list-card">
        <header class="card-head">
          <h2>作废纠错申请</h2>
          <el-button :loading="requestsLoading" :disabled="!authReady" link type="primary" @click="loadRequests()">刷新</el-button>
        </header>
        <div class="request-filters">
          <el-input v-model="filters.contractNo" data-test="void-contract-no-filter" clearable placeholder="合同编号" />
          <el-input v-model="filters.roomKeyword" data-test="void-room-filter" clearable placeholder="楼栋房号" />
          <el-input v-model="filters.tenantKeyword" data-test="void-tenant-filter" clearable placeholder="租户姓名" />
          <el-select v-model="filters.status" data-test="void-status-filter" clearable placeholder="全部状态">
            <el-option label="待确认" value="PENDING" />
            <el-option label="已完成" value="COMPLETED" />
            <el-option label="已驳回" value="REJECTED" />
            <el-option label="已取消" value="CANCELLED" />
          </el-select>
          <el-button data-test="search-void-requests" type="primary" :disabled="!authReady || saving" @click="loadRequests()">查询</el-button>
        </div>
        <small class="status-filter-help">状态筛选：待确认、已完成、已驳回、已取消</small>
        <el-table v-loading="requestsLoading" :data="requests" stripe row-key="id" empty-text="暂无合同作废纠错申请" max-height="560">
          <el-table-column prop="requestNo" label="申请编号" min-width="175" />
          <el-table-column label="合同" min-width="210"
            ><template #default="{ row }">{{ row.contract?.contractNo || `合同 #${row.contractId}` }}</template></el-table-column
          >
          <el-table-column label="房号" min-width="105"
            ><template #default="{ row }">{{ row.contract?.room?.fullHouseNo || `房源 #${row.contract?.roomId || row.contractId}` }}</template></el-table-column
          >
          <el-table-column label="租户" min-width="90"
            ><template #default="{ row }">{{ primaryTenant(row.contract) }}</template></el-table-column
          >
          <el-table-column prop="reason" label="原因" min-width="180" show-overflow-tooltip />
          <el-table-column label="提交人" width="90"
            ><template #default="{ row }">用户 #{{ row.submittedBy }}</template></el-table-column
          >
          <el-table-column label="状态" width="90"
            ><template #default="{ row }"
              ><el-tag :type="statusTagType(row.status)">{{ contractVoidStatusLabel(row.status) }}</el-tag></template
            ></el-table-column
          >
          <el-table-column label="提交时间" width="120"
            ><template #default="{ row }">{{ date(row.submittedAt) }}</template></el-table-column
          >
          <el-table-column label="操作" width="70" fixed="right"
            ><template #default="{ row }"><el-button :data-test="`void-request-detail-${row.id}`" link type="primary" @click="openRequest(row)">详情</el-button></template></el-table-column
          >
        </el-table>
      </section>

      <section v-loading="detailLoading" class="right-column">
        <template v-if="selectedRequest">
          <section class="contract-card request-detail">
            <header class="card-head">
              <div>
                <h2>{{ selectedRequest.requestNo }}</h2>
                <p>
                  {{ selectedRequest.contract?.contractNo || `合同 #${selectedRequest.contractId}` }}
                </p>
              </div>
              <el-tag :type="statusTagType(selectedRequest.status)" effect="dark">{{ contractVoidStatusLabel(selectedRequest.status) }}</el-tag>
            </header>
            <el-alert v-if="terminalRequest" title="终态申请仅可查看" type="info" :closable="false" show-icon />
            <el-descriptions :column="2" border>
              <el-descriptions-item label="楼栋房号">{{ selectedRequest.contract?.room?.fullHouseNo || '未记录房号' }}</el-descriptions-item>
              <el-descriptions-item label="租户姓名">{{ primaryTenant(selectedRequest.contract) }}</el-descriptions-item>
              <el-descriptions-item label="提交人">用户 #{{ selectedRequest.submittedBy }}</el-descriptions-item>
              <el-descriptions-item label="提交日期">{{ date(selectedRequest.submittedAt) }}</el-descriptions-item>
              <el-descriptions-item label="作废原因" :span="2">{{ selectedRequest.reason }}</el-descriptions-item>
              <el-descriptions-item v-if="selectedRequest.rejectedReason" label="驳回原因" :span="2">{{ selectedRequest.rejectedReason }}</el-descriptions-item>
            </el-descriptions>
          </section>
          <ContractVoidImpactCards v-if="selectedRequestImpact" :impact="selectedRequestImpact" />
          <section class="contract-card evidence-card">
            <header class="card-head"><h2>证明附件</h2></header>
            <el-empty v-if="!selectedRequest.files?.length" :image-size="48" description="暂无证明附件" />
            <div v-else class="evidence-list">
              <div v-for="file in selectedRequest.files" :key="file.fileAssetId">
                <span>{{ file.fileAsset.originalName }}</span>
                <div><el-button :data-test="`preview-void-request-file-${file.fileAssetId}`" link type="primary" :disabled="saving" @click="previewRequestProof(file)">预览</el-button><el-button link type="primary" :disabled="saving" @click="downloadRequestProof(file)">下载</el-button></div>
              </div>
            </div>
          </section>
          <section class="contract-card reversal-card-list">
            <header class="card-head"><h2>纠错冲销明细</h2></header>
            <el-empty v-if="!selectedRequest.reversals?.length" :image-size="48" description="暂无冲销明细" />
            <article v-for="row in selectedRequest.reversals" :key="row.id" class="reversal-card">
              <header>
                <b>{{ contractVoidCategoryLabel(row.category) }}</b
                ><span>原记录 #{{ row.originalEntityId ?? '未记录' }}</span>
              </header>
              <div>
                <span>来源：{{ contractVoidSourceLabel(row.originalEntityType) }}</span
                ><span>金额：{{ exactMoney(row.amount) }}</span>
              </div>
              <footer>
                <span>原业务日期：{{ date(row.originalOccurredAt) }}</span
                ><span>纠错日期：{{ date(row.correctionOccurredAt) }}</span>
              </footer>
            </article>
          </section>
          <div v-if="selectedRequest.status === 'PENDING'" class="request-actions">
            <el-button v-if="canCancelRequest" data-test="cancel-void-request" :disabled="saving" @click="cancelRequest">取消申请</el-button>
            <el-button v-if="role === 'SUPER_ADMIN'" data-test="reject-void-request" type="danger" plain :disabled="saving" @click="rejectRequest">驳回</el-button>
            <el-button v-if="role === 'SUPER_ADMIN'" data-test="approve-void-request" type="danger" :loading="saving" @click="approveRequest">确认作废并冲销</el-button>
          </div>
        </template>

        <template v-else>
          <section class="contract-card form-card">
            <header class="card-head">
              <div>
                <h2>新建作废申请</h2>
                <p>仅可选择尚未作废的合同</p>
              </div>
            </header>
            <div class="form-body">
              <el-form label-position="top">
                <el-form-item label="选择合同" required>
                  <el-select v-model="selectedId" data-test="void-contract-select" filterable :disabled="!authReady || saving || attachmentUploading" :filter-method="(value: string) => (contractKeyword = value)" placeholder="搜索合同编号、楼栋房号或租户姓名" no-match-text="未找到可作废的合同" @change="chooseContract">
                    <el-option v-for="item in visibleContracts" :key="item.id" :label="contractOptionLabel(item)" :value="item.id" />
                  </el-select>
                </el-form-item>
              </el-form>
              <el-empty v-if="!selectedContract" description="请选择需要作废纠错的合同" />
              <template v-else>
                <div class="selected-contract">
                  <div>
                    <b>{{ selectedContract.contractNo }}</b
                    ><span>{{ selectedContract.room?.fullHouseNo || `房源${selectedContract.roomId}` }}｜{{ primaryTenant(selectedContract) }}</span>
                  </div>
                  <el-tag v-if="selectedContract.status === 'VOIDED'" type="danger">已作废</el-tag>
                </div>
                <el-skeleton v-if="impactLoading" :rows="5" animated />
                <ContractVoidImpactCards v-else-if="impact" :impact="impact" />
                <el-alert v-else title="尚未生成关联影响，不能提交申请" type="warning" :closable="false" />
                <el-form label-position="top" class="void-form">
                  <el-form-item label="作废原因" required><el-input v-model="reason" data-test="void-reason" type="textarea" :disabled="!authReady || saving" :rows="3" maxlength="500" show-word-limit placeholder="请说明原合同错误及作废依据" /></el-form-item>
                  <el-form-item label="证明附件（可选）">
                    <el-upload :auto-upload="false" :show-file-list="false" accept=".pdf,.png,.jpg,.jpeg,.webp,.heic" :disabled="!authReady || saving || attachmentUploading" :on-change="uploadProof"><el-button :loading="attachmentUploading" :disabled="!authReady || saving">上传证明附件</el-button></el-upload>
                    <span class="upload-tip">上传成功后才会加入申请；支持图片和 PDF 预览</span>
                  </el-form-item>
                  <div v-if="uploadedProofs.length" class="evidence-list uploaded-list">
                    <div v-for="file in uploadedProofs" :key="file.id">
                      <span>{{ file.originalName }}</span>
                      <div><el-button :data-test="`preview-void-proof-${file.id}`" link type="primary" :disabled="!authReady" @click="previewUploadedProof(file)">预览</el-button><el-button :data-test="`remove-void-proof-${file.id}`" link type="danger" :disabled="!authReady || saving || attachmentUploading" @click="removeUploadedProof(file)">移除</el-button></div>
                    </div>
                  </div>
                  <div class="submit-actions">
                    <el-button data-test="submit-void-request" type="primary" :loading="saving" :disabled="submitDisabled" @click="submit(false)">{{ role === 'SUPER_ADMIN' ? '提交申请' : '提交作废申请' }}</el-button
                    ><el-button v-if="role === 'SUPER_ADMIN'" data-test="direct-execute-void" type="danger" :loading="saving" :disabled="submitDisabled" @click="submit(true)">直接执行作废</el-button>
                  </div>
                </el-form>
              </template>
            </div>
          </section>
        </template>
      </section>
    </div>

    <el-dialog v-model="previewOpen" :title="previewFile?.originalName || '证明附件预览'" width="820px" @closed="closeProofPreview">
      <img v-if="previewFile?.mimeType.startsWith('image/')" data-test="void-proof-preview" :src="previewFile.previewUrl" :alt="previewFile.originalName" class="proof-preview" />
      <iframe v-else-if="previewFile" data-test="void-proof-preview" :src="previewFile.previewUrl" :title="previewFile.originalName" class="proof-frame" />
    </el-dialog>
  </section>
</template>

<style scoped>
.page-head {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: 18px;
  margin-bottom: 16px;
}
.page-head h1 {
  margin: 0 0 5px;
  font-size: 22px;
}
.page-head p {
  margin: 0;
  color: #748196;
}
.void-layout {
  display: grid;
  grid-template-columns: minmax(560px, 1.05fr) minmax(520px, 0.95fr);
  gap: 15px;
  align-items: start;
}
.contract-card {
  overflow: hidden;
  background: #fff;
  border: 1px solid #e7ecf3;
  border-radius: 12px;
  box-shadow: 0 10px 28px rgb(28 52 84 / 7%);
}
.right-column {
  display: grid;
  gap: 13px;
  min-width: 0;
}
.card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 13px 16px;
  border-bottom: 1px solid #edf1f5;
}
.card-head h2,
.card-head p {
  margin: 0;
}
.card-head h2 {
  font-size: 16px;
}
.card-head p {
  margin-top: 3px;
  color: #748196;
  font-size: 12px;
}
.request-filters {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr 130px auto;
  gap: 8px;
  padding: 13px 15px 8px;
}
.status-filter-help {
  display: block;
  padding: 0 15px 10px;
  color: #8491a5;
}
.request-detail :deep(.el-alert) {
  margin: 12px 15px;
  width: auto;
}
.request-detail :deep(.el-descriptions) {
  padding: 0 15px 15px;
}
.form-body {
  padding: 15px;
}
.form-body :deep(.el-select) {
  width: 100%;
}
.selected-contract {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 11px 13px;
  margin-bottom: 12px;
  background: #f6f9ff;
  border: 1px solid #dce6f7;
  border-radius: 9px;
}
.selected-contract b,
.selected-contract span {
  display: block;
}
.selected-contract span {
  margin-top: 3px;
  color: #748196;
  font-size: 12px;
}
.void-form {
  margin-top: 14px;
  padding-top: 14px;
  border-top: 1px solid #edf1f5;
}
.upload-tip {
  margin-left: 10px;
  color: #8491a5;
  font-size: 12px;
}
.evidence-card,
.reversal-card-list {
  padding-bottom: 12px;
}
.evidence-list {
  display: grid;
  gap: 7px;
  padding: 12px 15px 2px;
}
.evidence-list > div {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 10px;
  background: #f7f9fc;
  border-radius: 7px;
}
.uploaded-list {
  padding: 0 0 12px;
}
.reversal-card {
  margin: 10px 15px 0;
  padding: 11px 12px;
  background: #f8faff;
  border: 1px solid #e3eaf4;
  border-radius: 8px;
}
.reversal-card header,
.reversal-card div,
.reversal-card footer {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 8px 18px;
}
.reversal-card div,
.reversal-card footer {
  padding-top: 7px;
  margin-top: 7px;
  color: #66758b;
  border-top: 1px dashed #dfe6ef;
}
.reversal-card footer {
  font-size: 12px;
}
.request-actions,
.submit-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
.request-actions {
  padding: 12px 15px;
  background: #fff;
  border: 1px solid #e7ecf3;
  border-radius: 10px;
}
.proof-preview {
  display: block;
  max-width: 100%;
  max-height: 68vh;
  margin: 0 auto;
  object-fit: contain;
}
.proof-frame {
  width: 100%;
  height: 68vh;
  border: 0;
}
@media (max-width: 1280px) {
  .void-layout {
    grid-template-columns: 1fr;
  }
  .request-filters {
    grid-template-columns: 1fr 1fr;
  }
}
@media (max-width: 760px) {
  .request-filters {
    grid-template-columns: 1fr;
  }
  .impact__cards {
    grid-template-columns: 1fr;
  }
}
</style>
