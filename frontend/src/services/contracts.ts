import { http } from './http'
import type {
  ContractConcession,
  ContractDetail,
  ContractDraft,
  ContractFile,
  ContractFormModel,
  ContractListItem,
  ContractPayload,
  ContractPreview,
  ContractRole,
  PricingRebate,
  RentBill,
} from '../types/contracts'

type ApiResponse<T> = { code: number; message: string; data: T }

const defined = <T>(value: T | '' | null | undefined): value is T => value !== '' && value !== null && value !== undefined

export function createLatestRequestGuard() {
  let generation = 0
  return {
    next: () => ++generation,
    isCurrent: (candidate: number) => candidate === generation,
  }
}

export function normalizeConcessionType(item: ContractConcession, concessionType: ContractConcession['concessionType']): ContractConcession {
  if (concessionType === 'RENT_FREE') return { concessionType, applyMode: 'DATE_RANGE', startDate: '', endDate: '', reason: item.reason }
  return { concessionType, applyMode: 'BILLING_PERIODS', billingPeriodCount: 1, ...(concessionType === 'FIXED_AMOUNT' ? { fixedAmount: '' } : { discountRate: '' }), reason: item.reason }
}

export function contractConcessionError(items: ContractConcession[]) {
  for (const item of items) {
    if (!item.reason.trim()) return '请填写优惠原因'
    if (item.concessionType === 'RENT_FREE') {
      if (item.applyMode !== 'DATE_RANGE' || !item.startDate || !item.endDate || item.endDate < item.startDate) return '请填写有效的免租日期区间'
      continue
    }
    if (item.applyMode !== 'BILLING_PERIODS' || !Number.isInteger(item.billingPeriodCount) || Number(item.billingPeriodCount) < 1) return '请填写有效的优惠账期数'
    if (item.concessionType === 'FIXED_AMOUNT' && (!item.fixedAmount || !Number.isFinite(Number(item.fixedAmount)) || Number(item.fixedAmount) < 0)) return '请填写非负的固定优惠金额'
    if (item.concessionType === 'PERCENTAGE' && (!item.discountRate || !Number.isFinite(Number(item.discountRate)) || Number(item.discountRate) < 0 || Number(item.discountRate) > 1)) return '请填写0至1之间的优惠比例'
  }
  return null
}

const concessionPayload = (item: ContractConcession): ContractConcession => item.concessionType === 'RENT_FREE'
  ? { concessionType: item.concessionType, applyMode: 'DATE_RANGE', startDate: item.startDate, endDate: item.endDate, reason: item.reason }
  : { concessionType: item.concessionType, applyMode: 'BILLING_PERIODS', billingPeriodCount: item.billingPeriodCount, ...(item.concessionType === 'FIXED_AMOUNT' ? { fixedAmount: item.fixedAmount } : { discountRate: item.discountRate }), reason: item.reason }

export function buildFixedRentRebatePayload(contract: ContractDetail, input: Record<string, unknown>) {
  if (!isFixedRentRebateEligible(contract)) throw new Error('退差仅适用于履行中的固定月租合同')
  return { ...input, contractId: contract.id, sourceType: 'FIXED_RENT_MANUAL', rebateType: 'MANUAL', pricingTierId: undefined }
}

export function toContractPayload(form: ContractFormModel, role: ContractRole): ContractPayload {
  const payload: ContractPayload = {
    ...(defined(form.externalContractNo) ? { externalContractNo: form.externalContractNo.trim() } : {}),
    ...(defined(form.roomId) ? { roomId: form.roomId } : {}),
    ...(defined(form.primaryTenantId) ? { primaryTenantId: form.primaryTenantId } : {}),
    secondaryTenantIds: [...form.secondaryTenantIds],
    ...(defined(form.startDate) ? { startDate: form.startDate } : {}),
    ...(defined(form.endDate) ? { endDate: form.endDate } : {}),
    ...(defined(form.plannedMoveInDate) ? { plannedMoveInDate: form.plannedMoveInDate } : {}),
    ...(defined(form.monthlyRent) ? { monthlyRent: form.monthlyRent } : {}),
    ...(defined(form.depositRequired) ? { depositRequired: form.depositRequired } : {}),
    paymentCycleMonths: form.paymentCycleMonths,
    concessions: form.concessions.map(concessionPayload),
    fileAssetIds: [...form.fileAssetIds],
    ...(defined(form.remark) ? { remark: form.remark.trim() } : {}),
  }
  if (
    role === 'SUPER_ADMIN' &&
    form.commission?.recipientName.trim() &&
    defined(form.commission.amount)
  ) {
    payload.commission = {
      recipientName: form.commission.recipientName.trim(),
      amount: form.commission.amount,
    }
  }
  return payload
}

export async function listContracts() {
  return (await http.get<ApiResponse<ContractListItem[]>>('/contracts')).data.data
}

export async function getContract(id: number) {
  return (await http.get<ApiResponse<ContractDetail>>(`/contracts/${id}`)).data.data
}

export async function getContractBills(id: number) {
  return (await http.get<ApiResponse<RentBill[]>>(`/contracts/${id}/bills`)).data.data
}

export async function getContractFiles(id: number) {
  return (await http.get<ApiResponse<ContractFile[]>>(`/contracts/${id}/files`)).data.data
}

export async function getContractChanges(id: number) {
  return (await http.get<ApiResponse<unknown[]>>(`/contracts/${id}/changes`)).data.data
}

export async function createContractDraft(payload: ContractPayload) {
  return (await http.post<ApiResponse<ContractDraft>>('/contracts/drafts', payload)).data.data
}

export async function updateContractDraft(id: number, payload: ContractPayload) {
  return (await http.patch<ApiResponse<ContractDraft>>(`/contracts/drafts/${id}`, payload)).data.data
}

export async function getContractDraft(id: number) {
  return (await http.get<ApiResponse<ContractDraft>>(`/contracts/drafts/${id}`)).data.data
}

export async function confirmContractDraft(id: number) {
  return (await http.post<ApiResponse<ContractListItem>>(`/contracts/drafts/${id}/confirm`)).data.data
}

export async function confirmFixedContract(payload: ContractPayload) {
  return (await http.post<ApiResponse<ContractListItem>>('/contracts/fixed', payload)).data.data
}

export async function previewFixedContract(payload: ContractPayload) {
  const body = {
    startDate: payload.startDate,
    endDate: payload.endDate,
    monthlyRent: payload.monthlyRent,
    concessions: payload.concessions,
  }
  return (await http.post<ApiResponse<ContractPreview>>('/contracts/fixed/preview', body)).data.data
}

export async function uploadContractFile(file: File) {
  const body = new FormData()
  body.append('file', file)
  return (await http.post<ApiResponse<ContractFile>>('/contracts/files', body)).data.data
}

export async function downloadContractFile(contractId: number, fileId: number) {
  return (await http.get(`/contracts/${contractId}/files/${fileId}/download`, { responseType: 'blob' })).data as Blob
}

export async function uploadPricingRebateProof(file: File) {
  const body = new FormData()
  body.append('file', file)
  return (await http.post<ApiResponse<ContractFile>>('/pricing-rebates/proof-files', body)).data.data
}

export async function listFixedRentRebates(contractId?: number) {
  return (await http.get<ApiResponse<PricingRebate[]>>('/pricing-rebates', {
    params: contractId ? { contractId } : undefined,
  })).data.data
}

export async function submitFixedRentRebate(contract: ContractDetail, input: Record<string, unknown>) {
  const payload = buildFixedRentRebatePayload(contract, input)
  return (await http.post<ApiResponse<PricingRebate>>('/pricing-rebates', payload)).data.data
}

export async function approveFixedRentRebate(id: number) {
  return (await http.post<ApiResponse<PricingRebate>>(`/pricing-rebates/${id}/approve`)).data.data
}

export async function rejectFixedRentRebate(id: number, reason: string) {
  return (await http.post<ApiResponse<PricingRebate>>(`/pricing-rebates/${id}/reject`, { reason })).data.data
}

export function isFixedRentRebateEligible(
  contract?: Pick<ContractListItem, 'status' | 'pricingMode'> | null,
) {
  return contract?.status === 'ACTIVE' && contract.pricingMode === 'FIXED'
}

export function fixedRentRebateContractLabel(contract: ContractListItem) {
  const room = contract.room?.fullHouseNo || `房源${contract.roomId}`
  const tenant = contract.members?.find((item) => item.memberRole === 'PRIMARY')?.tenant.name || '未记录租户'
  const missingDetails = [room, tenant].filter((detail) => !contract.contractNo.includes(detail))
  return [contract.contractNo, ...missingDetails].join('｜')
}

export function filterFixedRentRebateContracts(contracts: ContractListItem[], keyword: string) {
  const normalized = keyword.trim().toLocaleLowerCase('zh-CN')
  return contracts.filter((contract) => {
    if (!isFixedRentRebateEligible(contract)) return false
    if (!normalized) return true
    return fixedRentRebateContractLabel(contract).toLocaleLowerCase('zh-CN').includes(normalized)
  })
}
