import { calculateCheckoutAmounts } from './checkout-calculation';

describe('calculateCheckoutAmounts', () => {
  it('uses deposit for arrears and deductions before calculating refund and supplemental collection', () => {
    expect(
      calculateCheckoutAmounts({
        depositBalance: '10000.00',
        prepaymentBalance: '1200.00',
        rentOutstanding: '1600.00',
        otherCharges: '9000.00',
      }),
    ).toEqual({
      depositOffsetAmount: '1600.00',
      otherDeductionAmount: '8400.00',
      depositRefundableAmount: '0.00',
      prepaymentRefundableAmount: '1200.00',
      totalRefundAmount: '1200.00',
      supplementalArrearsAmount: '0.00',
      supplementalInspectionAmount: '600.00',
      finalReceivable: '600.00',
    });
  });

  it('returns the remaining deposit and all prepayment when no supplemental collection is needed', () => {
    expect(
      calculateCheckoutAmounts({
        depositBalance: '10000.00',
        prepaymentBalance: '500.00',
        rentOutstanding: '1000.00',
        otherCharges: '2000.00',
      }),
    ).toMatchObject({
      depositRefundableAmount: '7000.00',
      prepaymentRefundableAmount: '500.00',
      totalRefundAmount: '7500.00',
      finalReceivable: '0.00',
    });
  });
});
