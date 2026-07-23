import {
  billAmount,
  buildBillingPeriods,
  payableAmount,
  fixedDiscountForPeriod,
  percentageDiscountAmount,
  rentFreeAmount,
  tierForPeriod,
} from './billing-calculator';

describe('billing calculator', () => {
  it('uses contract anniversary periods and fixed 30-day proration for a partial tail', () => {
    const periods = buildBillingPeriods(
      new Date('2026-01-15T00:00:00.000Z'),
      new Date('2026-04-20T00:00:00.000Z'),
    );
    expect(periods).toHaveLength(4);
    expect(
      periods
        .slice(0, 3)
        .map((period) => billAmount('3000', period).toFixed(2)),
    ).toEqual(['3000.00', '3000.00', '3000.00']);
    expect(periods[3].start.toISOString().slice(0, 10)).toBe('2026-04-15');
    expect(billAmount('3000', periods[3]).toFixed(2)).toBe('600.00');
  });

  it('uses the highest reached custom tier for each period', () => {
    const tiers = [
      { thresholdMonths: 0, name: '基础' },
      { thresholdMonths: 2, name: '两月' },
      { thresholdMonths: 5, name: '五月' },
    ];
    expect(tierForPeriod(tiers, 1)?.name).toBe('基础');
    expect(tierForPeriod(tiers, 3)?.name).toBe('两月');
    expect(tierForPeriod(tiers, 6)?.name).toBe('五月');
  });

  it('never makes a bill payable amount negative after concessions', () => {
    expect(payableAmount('1000', '200', '100').toFixed(2)).toBe('700.00');
    expect(payableAmount('1000', '900', '200').toFixed(2)).toBe('0.00');
  });

  it('calculates date-range rent free by actual overlapping days with a 30-day divisor', () => {
    const period = buildBillingPeriods(
      new Date('2026-01-15'),
      new Date('2026-02-14'),
    )[0];
    expect(
      rentFreeAmount(
        '3000',
        period,
        new Date('2026-01-20'),
        new Date('2026-01-29'),
      ).toFixed(2),
    ).toBe('1000.00');
    expect(
      rentFreeAmount(
        '3000',
        period,
        new Date('2026-03-01'),
        new Date('2026-03-02'),
      ).toFixed(2),
    ).toBe('0.00');
  });

  it('calculates percentage discount per bill and assigns fixed discount remainder to the final period', () => {
    expect(percentageDiscountAmount('1000', '0.1').toFixed(2)).toBe('100.00');
    expect(fixedDiscountForPeriod('100', 1, 3).toFixed(2)).toBe('33.33');
    expect(fixedDiscountForPeriod('100', 3, 3).toFixed(2)).toBe('33.34');
  });
});
