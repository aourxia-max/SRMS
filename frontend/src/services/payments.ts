import { http } from './http'
import type { ContractSummary, PaymentDetail, PaymentListItem, RecordPaymentPayload, RentBill, ReviewItem } from '../types/payments'

type Envelope<T> = { code: number; message: string; data: T }
const data = <T>(response: { data: Envelope<T> }) => response.data.data

export const paymentApi = {
  async contracts() { return data(await http.get<Envelope<ContractSummary[]>>('/contracts')) },
  async bills(contractId: number) { return data(await http.get<Envelope<RentBill[]>>(`/contracts/${contractId}/bills`)) },
  async prepayments(contractId: number) { return data(await http.get<Envelope<{ balance: string; items: Record<string, unknown>[] }>>('/payments/prepayments', { params: { contractId } })) },
  async uploadProof(file: File) {
    const form = new FormData(); form.append('file', file)
    return data(await http.post<Envelope<{ id: number; originalName: string }>>('/payments/proof-files', form))
  },
  async record(payload: RecordPaymentPayload) { return data(await http.post<Envelope<{ id: number; receiptNo: string; receiptType: string }>>('/payments', payload)) },
  async list(params: Record<string, unknown>) { return data(await http.get<Envelope<PaymentListItem[]>>('/payments', { params })) },
  async detail(id: number) { return data(await http.get<Envelope<PaymentDetail>>(`/payments/${id}`)) },
  async edit(id: number, payload: Record<string, unknown>) { return data(await http.patch<Envelope<{ id: number; receiptNo: string }>>(`/payments/${id}`, payload)) },
  async downloadProof(paymentId: number, fileId: number) { return http.get(`/payments/${paymentId}/files/${fileId}`, { responseType: 'blob' }) },
  async submitRefund(payload: Record<string, unknown>) { return data(await http.post<Envelope<Record<string, unknown>>>('/payment-refunds', payload)) },
  async submitVoid(payload: Record<string, unknown>) { return data(await http.post<Envelope<Record<string, unknown>>>('/payment-void-requests', payload)) },
  async approveAdjustment(id: number) { return data(await http.post<Envelope<Record<string, unknown>>>(`/bill-adjustments/${id}/approve`)) },
  async rejectAdjustment(id: number, reason: string) { return data(await http.post<Envelope<Record<string, unknown>>>(`/bill-adjustments/${id}/reject`, { reason })) },
  async reviews(params: Record<string, unknown>) { return data(await http.get<Envelope<ReviewItem[]>>('/payment-reviews', { params })) },
  async reviewDetail(type: string, id: number) { return data(await http.get<Envelope<Record<string, any>>>(`/payment-reviews/${type}/${id}`)) },
  async approveReview(type: 'REFUND' | 'VOID', id: number, adjustmentDecisions: Record<string, unknown>[] = []) {
    const url = type === 'REFUND' ? `/payment-refunds/${id}/approve` : `/payment-void-requests/${id}/approve`
    return data(await http.post<Envelope<Record<string, unknown>>>(url, type === 'REFUND' ? { adjustmentDecisions } : undefined))
  },
  async rejectReview(type: 'REFUND' | 'VOID', id: number, reason: string) {
    const url = type === 'REFUND' ? `/payment-refunds/${id}/reject` : `/payment-void-requests/${id}/reject`
    return data(await http.post<Envelope<Record<string, unknown>>>(url, { reason }))
  },
}
