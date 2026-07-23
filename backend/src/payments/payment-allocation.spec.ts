import { allocatePayment } from './payment-allocation';

describe('payment allocation', () => {
  const bills = [
    { id: 1, outstandingAmount: '100.00' },
    { id: 2, outstandingAmount: '200.00' },
    { id: 3, outstandingAmount: '300.00' },
  ];

  it('allocates a single receipt across consecutive bills in order', () => {
    const result = allocatePayment('450', bills);
    expect(
      result.allocations.map((item) => [
        item.rentBillId,
        item.amount.toFixed(2),
      ]),
    ).toEqual([
      [1, '100.00'],
      [2, '200.00'],
      [3, '150.00'],
    ]);
    expect(result.prepaymentAmount.toFixed(2)).toBe('0.00');
  });

  it('keeps the final selected bill partially paid when money is insufficient', () => {
    const result = allocatePayment('150', bills);
    expect(result.allocations.map((item) => item.amount.toFixed(2))).toEqual([
      '100.00',
      '50.00',
    ]);
    expect(result.prepaymentAmount.toFixed(2)).toBe('0.00');
  });

  it('sends the amount over selected bill balances to prepayment', () => {
    const result = allocatePayment('350', bills.slice(0, 2));
    expect(result.allocations).toHaveLength(2);
    expect(result.prepaymentAmount.toFixed(2)).toBe('50.00');
  });
});
