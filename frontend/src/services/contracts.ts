import { http } from './http'
import type {
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
    concessions: form.concessions,
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

export async function submitFixedRentRebate(payload: Record<string, unknown>) {
  return (await http.post<ApiResponse<PricingRebate>>('/pricing-rebates', payload)).data.data
}

export async function approveFixedRentRebate(id: number) {
  return (await http.post<ApiResponse<PricingRebate>>(`/pricing-rebates/${id}/approve`)).data.data
}

export async function rejectFixedRentRebate(id: number, reason: string) {
  return (await http.post<ApiResponse<PricingRebate>>(`/pricing-rebates/${id}/reject`, { reason })).data.data
}
