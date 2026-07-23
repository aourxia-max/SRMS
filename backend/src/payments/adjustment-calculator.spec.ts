import { calculateAdjustedBill } from './adjustment-calculator';

describe('adjustment calculator', () => {
  it('reduces payable amount without letting outstanding amount become negative', () => {
    const result = calculateAdjustedBill({
      baseRentAmount: '100',
      rentFreeAmount: '0',
      discountAmount: '0',
      currentAdjustmentAmount: '0',
      receivedAmount: '90',
      direction: 'DECREASE',
      amount: '30',
    });
    expect(result.adjustmentAmount.toFixed(2)).toBe('-30.00');
    expect(result.payableAmount.toFixed(2)).toBe('70.00');
    expect(result.outstandingAmount.toFixed(2)).toBe('0.00');
    expect(result.status).toBe('PAID');
  });

  it('increases payable amount and leaves a paid bill partially unpaid', () => {
    const result = calculateAdjustedBill({
      baseRentAmount: '100',
      rentFreeAmount: '0',
      discountAmount: '0',
      currentAdjustmentAmount: '0',
      receivedAmount: '100',
      direction: 'INCREASE',
      amount: '20',
    });
    expect(result.payableAmount.toFixed(2)).toBe('120.00');
    expect(result.outstandingAmount.toFixed(2)).toBe('20.00');
    expect(result.status).toBe('PARTIAL');
  });
});
