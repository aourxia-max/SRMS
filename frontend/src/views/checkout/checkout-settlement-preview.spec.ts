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
  finalReceivable: '0.00',
  items: [],
};

describe('退租结算实时预估', () => {
  afterEach(() => vi.useRealTimers());

  it('shows the four amounts returned by the backend preview', () => {
    const wrapper = mount(CheckoutSettlementPanel, {
      props: {
        settlements: [settlement],
        preview: {
          depositRefundableAmount: '7000.00',
          prepaymentRefundableAmount: '500.00',
          totalRefundAmount: '7500.00',
          finalReceivable: '0.00',
        },
      },
    });

    const summary = wrapper.get('[data-test="settlement-summary"]');
    expect(summary.text()).toContain('¥7,000.00');
    expect(summary.text()).toContain('¥500.00');
    expect(summary.text()).toContain('¥7,500.00');
    expect(summary.text()).toContain('¥0.00');
    expect(summary.text()).not.toContain('待计算');
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
});
