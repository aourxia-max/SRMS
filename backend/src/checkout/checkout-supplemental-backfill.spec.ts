import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function reconcileLegacySupplemental(
  rentOutstandingAtApproval: number,
  depositOffsetAmount: number,
  legacyFinalReceivable: number,
  currentArrearsAmount: number,
) {
  const initialArrearsAmount = Math.min(
    Math.max(rentOutstandingAtApproval - depositOffsetAmount, 0),
    legacyFinalReceivable,
  );
  const inspectionAmount = Math.max(
    legacyFinalReceivable - initialArrearsAmount,
    0,
  );
  const arrearsAmount = Math.max(initialArrearsAmount, currentArrearsAmount);
  const receivedAmount = Math.max(arrearsAmount - currentArrearsAmount, 0);
  const outstandingAmount = currentArrearsAmount + inspectionAmount;
  return {
    arrearsAmount,
    inspectionAmount,
    receivedAmount,
    outstandingAmount,
    finalReceivable: receivedAmount + outstandingAmount,
  };
}

describe('legacy checkout supplemental backfill migration', () => {
  it.each([
    ['纯欠租', 100, 0, 100, 100, 100, 0, 0, 100, 100],
    ['纯验房扣款', 0, 0, 100, 0, 0, 100, 0, 100, 100],
    ['押金先抵欠租后的混合补收', 100, 50, 150, 50, 50, 100, 0, 150, 150],
    ['押金结清欠租后只剩验房补收', 100, 100, 50, 0, 0, 50, 0, 50, 50],
    ['审批后欠租全部收清', 100, 0, 100, 0, 100, 0, 100, 0, 100],
    ['审批后欠租部分收清', 100, 0, 100, 40, 100, 0, 60, 40, 100],
    ['审批后欠租因退款增加', 100, 0, 100, 120, 120, 0, 0, 120, 120],
  ] as const)(
    '%s reconciles the current bill balance without charging twice',
    (
      _caseName,
      rentOutstandingAtApproval,
      depositOffsetAmount,
      legacyFinalReceivable,
      currentArrearsAmount,
      expectedArrears,
      expectedInspection,
      expectedReceived,
      expectedOutstanding,
      expectedFinal,
    ) => {
      expect(
        reconcileLegacySupplemental(
          rentOutstandingAtApproval,
          depositOffsetAmount,
          legacyFinalReceivable,
          currentArrearsAmount,
        ),
      ).toEqual({
        arrearsAmount: expectedArrears,
        inspectionAmount: expectedInspection,
        receivedAmount: expectedReceived,
        outstandingAmount: expectedOutstanding,
        finalReceivable: expectedFinal,
      });
    },
  );

  it('keeps component totals stable when a migrated supplemental receipt is refunded', () => {
    const migrated = reconcileLegacySupplemental(100, 0, 100, 40);
    const afterCollection = {
      receivedAmount: migrated.receivedAmount + 40,
      outstandingAmount: 0,
    };
    const afterRefund = {
      receivedAmount: afterCollection.receivedAmount - 40,
      outstandingAmount:
        migrated.arrearsAmount +
        migrated.inspectionAmount -
        (afterCollection.receivedAmount - 40),
    };

    expect(migrated.arrearsAmount + migrated.inspectionAmount).toBe(
      migrated.receivedAmount + migrated.outstandingAmount,
    );
    expect(afterRefund).toEqual({
      receivedAmount: 60,
      outstandingAmount: 40,
    });
  });

  it('uses current linked rent-bill balances in the deployed SQL formula', () => {
    const sql = readFileSync(
      join(
        process.cwd(),
        'prisma/migrations/20260823141500_backfill_legacy_checkout_supplemental/migration.sql',
      ),
      'utf8',
    );
    const normalized = sql.replace(/\s+/g, ' ');

    expect(normalized).toContain(
      '`settlement`.`rent_outstanding` - `settlement`.`deposit_offset_amount`',
    );
    expect(normalized).toContain('SELECT DISTINCT');
    expect(normalized).toContain('AS `current_arrears_amount`');
    expect(normalized).toContain(
      '`settlement`.`supplemental_received_amount` = GREATEST(',
    );
    expect(normalized).toContain(
      '`settlement`.`supplemental_received_amount` + `settlement`.`supplemental_outstanding_amount`',
    );
    expect(normalized).toContain("WHERE `settlement`.`status` = 'APPROVED'");
    expect(normalized).toContain(
      "AND `contract`.`status` = 'PENDING_CHECKOUT'",
    );
  });
});
