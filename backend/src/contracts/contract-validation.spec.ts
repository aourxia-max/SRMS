import {
  assertContractDates,
  assertContractRoomStatus,
  assertConcessions,
  assertPrimaryTenant,
} from './contract-validation';

describe('contract validation', () => {
  it('rejects invalid contract dates, cycle, room statuses and primary tenant', () => {
    expect(() =>
      assertContractDates(new Date('2026-02-02'), new Date('2026-02-01'), 1),
    ).toThrow();
    expect(() =>
      assertContractDates(new Date('2026-02-01'), new Date('2026-02-02'), 13),
    ).toThrow();
    expect(() => assertContractRoomStatus('SOLD')).toThrow();
    expect(() => assertPrimaryTenant([1, 2], 3)).toThrow();
  });

  it('only accepts concession application modes with a defined calculation rule', () => {
    expect(() =>
      assertConcessions([
        {
          concessionType: 'RENT_FREE',
          applyMode: 'BILLING_PERIODS',
          billingPeriodCount: 1,
          reason: 'test',
        },
      ]),
    ).toThrow();
    expect(() =>
      assertConcessions([
        {
          concessionType: 'PERCENTAGE',
          applyMode: 'BILLING_PERIODS',
          billingPeriodCount: 2,
          discountRate: '0.1',
          reason: 'test',
        },
      ]),
    ).not.toThrow();
  });
});
