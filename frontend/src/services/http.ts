import axios from 'axios'

export const http = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL ?? '/api',
  timeout: 10_000,
  withCredentials: true,
})

export type RentBillStatus = 'PENDING' | 'PARTIAL' | 'PAID' | 'OVERDUE' | 'VOIDED' | 'REFUNDED'
export type RentBillQuery = { keyword?: string; buildingId?: number; status?: RentBillStatus; month?: string; page?: number; pageSize?: number }
export type RentBillListItem = {
  id: number; billNo: string
  room: { id: number; fullHouseNo: string; buildingId: number; buildingName: string }
  contract: { id: number; contractNo: string }
  tenant: { id: number; name: string } | null
  periodStart: string; periodEnd: string; dueDate: string
  baseRentAmount: string; rentFreeAmount: string; discountAmount: string; payableAmount: string; receivedAmount: string; outstandingAmount: string
  status: RentBillStatus
}
export type RentBillListData = { items: RentBillListItem[]; page: number; pageSize: number; total: number; summary: { payable: string; received: string; outstanding: string; count: number; overdueCount: number } }
export type RentBillDetail = RentBillListItem & { adjustments: Array<Record<string, unknown>>; allocations: Array<Record<string, unknown>>; prepaymentTransactions: Array<Record<string, unknown>> }

export async function fetchRentBills(query: RentBillQuery) {
  return (await http.get<{ data: RentBillListData }>('/rent-bills', { params: query })).data.data
}

export async function fetchRentBill(id: number) {
  return (await http.get<{ data: RentBillDetail }>(`/rent-bills/${id}`)).data.data
}
