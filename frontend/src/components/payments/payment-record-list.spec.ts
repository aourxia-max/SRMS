import { mount } from '@vue/test-utils'
import ElementPlus, { ElPagination } from 'element-plus'
import { describe, expect, it } from 'vitest'
import type { PaymentListItem } from '../../types/payments'
import PaymentRecordList from './PaymentRecordList.vue'

const row: PaymentListItem = {
  id: 81,
  receiptNo: 'SK-TEST-81',
  receiptType: 'FORMAL',
  paymentCategory: 'RENT',
  paymentDate: '2026-08-04',
  amount: '570.00',
  method: 'BANK_TRANSFER',
  status: 'CONFIRMED',
  contract: {
    id: 7,
    contractNo: 'HT202608040001 | 1\u680b201 | \u5f20\u4e09',
    room: { id: 21, fullHouseNo: '1\u680b201' },
  },
  tenant: { id: 9, name: '\u5f20\u4e09' },
}

describe('PaymentRecordList', () => {
  it('shows the filtered total and emits local page changes', async () => {
    const wrapper = mount(PaymentRecordList, {
      props: {
        rows: [row],
        total: 26,
        currentPage: 1,
        pageSize: 10,
        selectedId: 81,
      },
      global: { plugins: [ElementPlus] },
    })

    expect(wrapper.text()).toContain('\u6536\u6b3e\u8bb0\u5f55\uff08\u5171 26 \u7b14\uff09')
    const pagination = wrapper.findComponent(ElPagination)
    expect(pagination.props('pageSize')).toBe(10)
    expect(pagination.props('total')).toBe(26)

    pagination.vm.$emit('current-change', 2)
    await wrapper.vm.$nextTick()

    expect(wrapper.emitted('page-change')).toEqual([[2]])
  })

  it('labels checkout supplemental receipts in Chinese', () => {
    const wrapper = mount(PaymentRecordList, {
      props: {
        rows: [{ ...row, paymentCategory: 'CHECKOUT_SUPPLEMENTAL' }],
        total: 1,
        currentPage: 1,
        pageSize: 10,
        selectedId: 81,
      },
      global: { plugins: [ElementPlus] },
    })

    expect(wrapper.text()).toContain('退租补收')
  })
  it('emits the selected payment id without changing the page', async () => {
    const wrapper = mount(PaymentRecordList, {
      props: {
        rows: [row],
        total: 1,
        currentPage: 1,
        pageSize: 10,
        selectedId: null,
      },
      global: { plugins: [ElementPlus] },
    })

    await wrapper.get('[data-test="payment-record-81"]').trigger('click')

    expect(wrapper.emitted('select')).toEqual([[81]])
    expect(wrapper.emitted('page-change')).toBeUndefined()
  })
})
