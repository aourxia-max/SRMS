import {
  allocateCheckoutRentRefund,
  CheckoutRentRefundExceedsAvailableError,
  type RentRefundCandidate,
} from './checkout-rent-refund-allocation';

const candidate = (
  paymentAllocationId: number,
  periodStart: string,
  periodEnd: string,
  availableAmount: string,
  paymentDate: string,
  overrides: Partial<RentRefundCandidate> = {},
): RentRefundCandidate => ({
  paymentAllocationId,
  paymentId: paymentAllocationId * 10,
  rentBillId: paymentAllocationId * 100,
  periodStart: new Date(periodStart),
  periodEnd: new Date(periodEnd),
  paymentDate: new Date(paymentDate),
  availableAmount,
  ...overrides,
});

describe('allocateCheckoutRentRefund', () => {
  it('uses future rent periods before the checkout period', () => {
    expect(
      allocateCheckoutRentRefund({
        actualCheckoutDate: new Date('2026-08-15'),
        requestedAmount: '4000.00',
        candidates: [
          candidate(1, '2026-08-01', '2026-08-31', '3000.00', '2026-08-01'),
          candidate(2, '2026-09-01', '2026-09-30', '3000.00', '2026-08-01'),
        ],
      }).allocations,
    ).toEqual([
      {
        paymentAllocationId: 2,
        paymentId: 20,
        rentBillId: 200,
        amount: '3000.00',
      },
      {
        paymentAllocationId: 1,
        paymentId: 10,
        rentBillId: 100,
        amount: '1000.00',
      },
    ]);
  });

  it('excludes completed historical periods', () => {
    const result = allocateCheckoutRentRefund({
      actualCheckoutDate: new Date('2026-08-15'),
      requestedAmount: '3000.00',
      candidates: [
        candidate(1, '2026-07-01', '2026-07-31', '3000.00', '2026-07-01'),
        candidate(2, '2026-08-01', '2026-08-31', '3000.00', '2026-08-01'),
      ],
    });

    expect(result.maxRefundableAmount).toBe('3000.00');
    expect(result.allocations).toEqual([
      {
        paymentAllocationId: 2,
        paymentId: 20,
        rentBillId: 200,
        amount: '3000.00',
      },
    ]);
  });

  it('uses later payments first within a rent bill, breaking ties by allocation id', () => {
    expect(
      allocateCheckoutRentRefund({
        actualCheckoutDate: new Date('2026-08-15'),
        requestedAmount: '300.00',
        candidates: [
          candidate(10, '2026-09-01', '2026-09-30', '100.00', '2026-08-03', {
            rentBillId: 1,
          }),
          candidate(12, '2026-09-01', '2026-09-30', '100.00', '2026-08-04', {
            rentBillId: 1,
          }),
          candidate(11, '2026-09-01', '2026-09-30', '100.00', '2026-08-04', {
            rentBillId: 1,
          }),
        ],
      }).allocations.map((item) => item.paymentAllocationId),
    ).toEqual([12, 11, 10]);
  });

  it('supports a partial reversal across payment allocations', () => {
    expect(
      allocateCheckoutRentRefund({
        actualCheckoutDate: new Date('2026-08-15'),
        requestedAmount: '125.55',
        candidates: [
          candidate(2, '2026-10-01', '2026-10-31', '100.00', '2026-08-02'),
          candidate(1, '2026-09-01', '2026-09-30', '100.00', '2026-08-01'),
        ],
      }).allocations.map((item) => [item.paymentAllocationId, item.amount]),
    ).toEqual([
      [2, '100.00'],
      [1, '25.55'],
    ]);
  });

  it('rejects a request above the refundable maximum', () => {
    try {
      allocateCheckoutRentRefund({
        actualCheckoutDate: new Date('2026-08-15'),
        requestedAmount: '100.01',
        candidates: [
          candidate(1, '2026-09-01', '2026-09-30', '100.00', '2026-08-01'),
        ],
      });
      fail('expected allocation to reject an excessive refund request');
    } catch (error) {
      expect(error).toBeInstanceOf(CheckoutRentRefundExceedsAvailableError);
      expect(
        (error as CheckoutRentRefundExceedsAvailableError).maxRefundableAmount,
      ).toBe('100.00');
    }
  });

  it('reports a zero maximum and rejects positive requests when no amount is available', () => {
    try {
      allocateCheckoutRentRefund({
        actualCheckoutDate: new Date('2026-08-15'),
        requestedAmount: '0.01',
        candidates: [
          candidate(1, '2026-09-01', '2026-09-30', '0.00', '2026-08-01'),
        ],
      });
      fail(
        'expected allocation to reject a positive request without availability',
      );
    } catch (error) {
      expect(
        (error as CheckoutRentRefundExceedsAvailableError).maxRefundableAmount,
      ).toBe('0.00');
    }
  });

  it('returns the maximum without allocations for a zero-amount preview request', () => {
    expect(
      allocateCheckoutRentRefund({
        actualCheckoutDate: new Date('2026-08-15'),
        requestedAmount: '0.00',
        candidates: [
          candidate(2, '2026-09-01', '2026-09-30', '30.00', '2026-08-02'),
          candidate(1, '2026-08-01', '2026-08-31', '20.00', '2026-08-01'),
        ],
      }),
    ).toEqual({
      maxRefundableAmount: '50.00',
      requestedAmount: '0.00',
      allocations: [],
    });
  });
});
