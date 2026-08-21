import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PaymentListItem, PaymentListPage } from '../types/payments'
import { listAllPayments, paymentApi } from './payments'

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
})
