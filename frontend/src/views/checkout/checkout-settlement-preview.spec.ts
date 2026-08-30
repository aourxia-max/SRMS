import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import CheckoutSettlementPanel from './CheckoutSettlementPanel.vue';

const settlement = {
  id: 8,
  settlementNo: 'TZ202608250001',
  status: 'DRAFT' as const,
  contractId: 3,
  actualCheckoutDate: '2026-08-25',
  handoverDate: '2026-08-25',
  inspectionAt: '2026-08-25',
  targetRoomStatus: 'EMPTY' as const,
  depositRefundableAmount: '0.00',
  prepaymentRefundableAmount: '0.00',
  rentRefundableAmount: "0.00",
  finalReceivable: '0.00',
  items: [],
};

const rentRefundPreview = {
  depositRefundableAmount: '7000.00',
  prepaymentRefundableAmount: '500.00',
  rentRefundableAmount: '3000.00',
  maxRentRefundAmount: '3000.00',
  totalRefundAmount: '10500.00',
  finalReceivable: '0.00',
  rentRefundAllocations: [
    {
      paymentAllocationId: 81,
      paymentId: 72,
      receiptNo: 'SK20260800072',
      rentBillId: 33,
      billNo: 'ZF2026090001',
      amount: '3000.00',
    },
  ],
};

describe('退租结算实时预估', () => {
  afterEach(() => vi.useRealTimers());

  it('shows the five labelled backend summary values, including zero amounts', () => {
    const wrapper = mount(CheckoutSettlementPanel, {
      props: {
        settlements: [settlement],
        preview: {
          depositRefundableAmount: '7000.00',
          prepaymentRefundableAmount: '500.00',
          rentRefundableAmount: '0.00',
          maxRentRefundAmount: '0.00',
          rentRefundAllocations: [],
          totalRefundAmount: '7500.00',
          finalReceivable: '0.00',
        },
      },
    });

    const summary = wrapper.get('[data-test="settlement-summary"]');
    expect(summary.text()).toContain('应退押金');
    expect(summary.text()).toContain('应退预收款');
    expect(summary.text()).toContain('¥7,000.00');
    expect(summary.text()).toContain('应退租金');
    expect(summary.text()).toContain('¥0.00');
    expect(summary.text()).toContain('¥500.00');
    expect(summary.text()).toContain('合计应退');
    expect(summary.text()).toContain('¥7,500.00');
    expect(summary.text()).toContain('待补收金额');
    expect(summary.text()).toContain('¥0.00');
    expect(summary.text()).not.toContain('待计算');
  });


  it('adds one rent refund item, presents the server allocation preview, and submits only its allowed DTO fields', async () => {
    const wrapper = mount(CheckoutSettlementPanel, {
      props: { settlements: [settlement], preview: rentRefundPreview },
    });

    await wrapper.get('[data-test="add-rent-refund"]').trigger('click');
    await wrapper.get('[data-test="rent-refund-amount"]').setValue('3000');
    await wrapper.get('[data-test="rent-refund-description"]').setValue('提前退房退还未履行租金');

    expect(wrapper.findAll('[data-test="rent-refund-item"]')).toHaveLength(1);
    expect(wrapper.text()).toContain('当前最多可退租金 ¥3,000.00');
    expect(wrapper.text()).toContain('系统自动回冲预览');
    expect(wrapper.text()).toContain('收款单号 SK20260800072');
    expect(wrapper.text()).toContain('¥3,000.00');
    expect(wrapper.text()).not.toContain('paymentId');
    expect(wrapper.text()).toContain('ZF2026090001');
    expect(wrapper.find('[data-test="rent-refund-item"] [placeholder="验房记录编号"]').exists()).toBe(false);

    await wrapper.get('[data-test="settlement-submit"]').trigger('click');
    expect(wrapper.emitted('submit')?.[0]?.[1]).toMatchObject({
      items: [
        {
          itemType: 'RENT_REFUND',
          amount: '3000.00',
          description: '提前退房退还未履行租金',
        },
      ],
    });
    const submitted = wrapper.emitted('submit')?.[0]?.[1] as {
      items: unknown[];
    };
    expect(submitted.items[0]).toEqual({
      itemType: 'RENT_REFUND',
      amount: '3000.00',
      description: '提前退房退还未履行租金',
    });
  });

  it('keeps a single rent refund item and blocks an amount above the backend maximum', async () => {
    const wrapper = mount(CheckoutSettlementPanel, {
      props: { settlements: [settlement], preview: rentRefundPreview },
    });

    await wrapper.get('[data-test="add-rent-refund"]').trigger('click');
    await wrapper.get('[data-test="add-rent-refund"]').trigger('click');
    await wrapper.get('[data-test="rent-refund-amount"]').setValue('3000.01');
    await wrapper.get('[data-test="settlement-submit"]').trigger('click');

    expect(wrapper.findAll('[data-test="rent-refund-item"]')).toHaveLength(1);
    expect(wrapper.get('[role="alert"]').text()).toContain(
      '退还租金不能超过当前可回冲金额 ¥3,000.00。',
    );
    expect(wrapper.emitted('submit')).toBeUndefined();
  });

  it('requires a rent refund description and refreshes its preview after the actual checkout date changes', async () => {
    vi.useFakeTimers();
    const wrapper = mount(CheckoutSettlementPanel, {
      props: { settlements: [settlement], preview: rentRefundPreview },
    });

    await wrapper.get('[data-test="add-rent-refund"]').trigger('click');
    await wrapper.get('[data-test="rent-refund-amount"]').setValue('100');
    await wrapper.get('[data-test="settlement-submit"]').trigger('click');
    expect(wrapper.get('[role="alert"]').text()).toContain('请填写第 1 项结算说明');

    await wrapper.get('[data-test="rent-refund-description"]').setValue('退还租金');
    await wrapper.get('input[type="date"]').setValue('2026-08-26');
    await vi.advanceTimersByTimeAsync(300);

    expect(wrapper.emitted('preview')?.at(-1)?.[1]).toMatchObject({
      actualCheckoutDate: '2026-08-26',
      items: [
        {
          itemType: 'RENT_REFUND',
          amount: '100.00',
          description: '退还租金',
        },
      ],
    });
  });
  it('debounces preview requests when editable settlement data changes', async () => {
    vi.useFakeTimers();
    const wrapper = mount(CheckoutSettlementPanel, {
      props: { settlements: [settlement] },
    });
    await wrapper.get('input[type="date"]').setValue('2026-08-26');
    await vi.advanceTimersByTimeAsync(300);

    expect(wrapper.emitted('preview')?.at(-1)?.[0]).toBe(8);
    expect(wrapper.emitted('preview')?.at(-1)?.[1]).toMatchObject({
      actualCheckoutDate: '2026-08-26',
      items: [],
    });
  });
  it('keeps the rent-refund input described while the maximum is still loading', async () => {
    const wrapper = mount(CheckoutSettlementPanel, {
      props: { settlements: [settlement], previewLoading: true },
    });

    await wrapper.get('[data-test="add-rent-refund"]').trigger('click');

    expect(wrapper.get('[data-test="rent-refund-amount"]').attributes('aria-describedby')).toBe('rent-refund-limit');
    expect(wrapper.get('#rent-refund-limit').attributes('aria-live')).toBe('polite');
  });
});
