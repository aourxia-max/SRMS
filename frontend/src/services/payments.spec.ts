import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PaymentListItem, PaymentListPage } from '../types/payments'
import { listAllPayments, paymentApi, paymentContractOptions, preselectedPaymentContractId } from './payments'
import { listContracts } from './contracts'
import { http } from './http'

function page(ids: number[], pageNumber: number, total: number): PaymentListPage {
  return {
    items: ids.map((id) => ({ id }) as PaymentListItem),
    page: pageNumber,
    pageSize: 100,
    total,
  }
}

describe('listAllPayments', () => {
  afterEach(() => vi.restoreAllMocks())

  it('loads every page so contract payment history is never truncated', async () => {
    const list = vi.spyOn(paymentApi, 'list')
      .mockResolvedValueOnce(page(Array.from({ length: 100 }, (_, index) => index + 1), 1, 101))
      .mockResolvedValueOnce(page([101], 2, 101))

    const result = await listAllPayments({ contractId: 7 })

    expect(result).toHaveLength(101)
    expect(result.at(-1)?.id).toBe(101)
    expect(list).toHaveBeenNthCalledWith(1, { contractId: 7, page: 1, pageSize: 100 })
    expect(list).toHaveBeenNthCalledWith(2, { contractId: 7, page: 2, pageSize: 100 })
  })

  it('keeps voided contracts in the audit list but removes them from payment options and route preselection', async () => {
    const rows = [
      { id: 1, contractNo: 'HT-001', status: 'ACTIVE' },
      { id: 2, contractNo: 'HT-002', status: 'VOIDED' },
    ]
    vi.spyOn(http, 'get').mockResolvedValue({ data: { data: rows } } as never)

    const auditContracts = await listContracts()
    const paymentContracts = await paymentApi.contracts()

    expect(auditContracts.map((contract) => contract.id)).toEqual([1, 2])
    expect(paymentContracts.map((contract) => contract.id)).toEqual([1])
    expect(paymentContractOptions(rows).map((contract) => contract.id)).toEqual([1])
    expect(preselectedPaymentContractId(rows, '1')).toBe(1)
    expect(preselectedPaymentContractId(rows, '2')).toBeUndefined()
  })
  it('requests only bills eligible for ordinary collection', async () => {
    const get = vi.spyOn(http, 'get').mockResolvedValue({
      data: { data: [] },
    } as never)

    await paymentApi.bills(7)

    expect(get).toHaveBeenCalledWith('/contracts/7/bills', {
      params: { collectible: true },
    })
  })})
