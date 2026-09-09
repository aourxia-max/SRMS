import {
  effectiveRentBillStatus,
  isRentBillPerformed,
  resolveCheckoutCutoff,
} from './checkout-accounting-cutoff';

describe('checkout accounting cutoff', () => {
  const cutoff = new Date('2026-09-01T00:00:00.000Z');

  it('treats checkout day and later bill periods as unperformed', () => {
    expect(isRentBillPerformed(new Date('2026-08-01'), cutoff)).toBe(true);
    expect(isRentBillPerformed(new Date('2026-09-01'), cutoff)).toBe(false);
    expect(isRentBillPerformed(new Date('2026-10-01'), cutoff)).toBe(false);
  });

  it('projects an unperformed overdue bill as pending checkout review', () => {
    expect(effectiveRentBillStatus('OVERDUE', cutoff, cutoff)).toBe(
      'PENDING_CHECKOUT_REVIEW',
    );
  });

  it('ignores cancelled and completed settlements as temporary cutoffs', () => {
    expect(
      resolveCheckoutCutoff([
        { status: 'CANCELLED', actualCheckoutDate: cutoff },
      ]),
    ).toBeNull();
    expect(
      resolveCheckoutCutoff([
        { status: 'COMPLETED', actualCheckoutDate: cutoff },
      ]),
    ).toBeNull();
  });

  it('uses the first active settlement that has an actual checkout date', () => {
    expect(
      resolveCheckoutCutoff([
        { status: 'PENDING', actualCheckoutDate: null },
        { status: 'REJECTED', actualCheckoutDate: cutoff },
        {
          status: 'APPROVED',
          actualCheckoutDate: new Date('2026-09-15T00:00:00.000Z'),
        },
      ]),
    ).toEqual(cutoff);
  });

  it('keeps the current status when there is no cutoff', () => {
    for (const status of ['PENDING', 'PARTIAL', 'OVERDUE', 'PAID'] as const) {
      expect(
        effectiveRentBillStatus(status, new Date('2026-09-01'), null),
      ).toBe(status);
    }
  });

  it('preserves terminal bill statuses after the cutoff', () => {
    expect(effectiveRentBillStatus('VOIDED', cutoff, cutoff)).toBe('VOIDED');
    expect(effectiveRentBillStatus('REFUNDED', cutoff, cutoff)).toBe(
      'REFUNDED',
    );
  });

  it('projects every non-terminal bill status after the cutoff for review', () => {
    for (const status of ['PENDING', 'PARTIAL', 'OVERDUE', 'PAID'] as const) {
      expect(effectiveRentBillStatus(status, cutoff, cutoff)).toBe(
        'PENDING_CHECKOUT_REVIEW',
      );
    }
  });

  it('treats a missing actual checkout date as having no cutoff', () => {
    expect(
      resolveCheckoutCutoff([
        { status: 'DRAFT', actualCheckoutDate: null },
        { status: 'CANCELLED', actualCheckoutDate: cutoff },
      ]),
    ).toBeNull();
    expect(isRentBillPerformed(cutoff, null)).toBe(true);
  });
});
