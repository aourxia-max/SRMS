import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CheckoutService } from './checkout.service';
import type { SubmitCheckoutSettlementDto } from './dto/submit-checkout-settlement.dto';

const changedMessage = '实际退房日期或账单已变化，请重新预估结算金额';
const user = {
  id: 1,
  username: 'admin',
  displayName: '管理员',
  role: 'ADMIN' as const,
};
const money = (value: string) => new Prisma.Decimal(value);
const input = (): SubmitCheckoutSettlementDto => ({
  actualCheckoutDate: '2026-09-01',
  handoverDate: '2026-09-01',
  inspectionAt: '2026-09-01',
  targetRoomStatus: 'EMPTY',
  items: [
    {
      itemType: 'RENT_REFUND',
      amount: '100.00',
      description: '退还租金',
      evidenceRequired: false,
      confirmedByTenant: false,
    },
  ],
});

function harness() {
  const bill = (id: number, periodStart: string) => ({
    id,
    billNo: `ZD${id}`,
    billCategory: 'RENT',
    status: 'PAID',
    periodStart: new Date(periodStart),
    periodEnd: new Date('2026-12-31'),
    dueDate: new Date(periodStart),
    payableAmount: money('200'),
    receivedAmount: money('200'),
    outstandingAmount: money('0'),
  });
  const allocation = (id: number, periodStart: string) => ({
    id,
    paymentId: id + 10,
    rentBillId: id + 20,
    allocatedAmount: money('200'),
    reversedAmount: money('0'),
    payment: {
      paymentDate: new Date('2026-08-30'),
      receiptNo: `SK${id}`,
      voidRequests: [] as { id: number }[],
    },
    rentBill: bill(id + 20, periodStart),
    refundAllocations: [] as { reversedAmount: Prisma.Decimal }[],
    checkoutRentRefundAllocations: [] as {
      reservedAmount: Prisma.Decimal;
      item: { checkoutSettlementId: number };
    }[],
  });
  const settlement = {
    id: 8,
    contractId: 3,
    status: 'DRAFT',
    originContractStatus: 'ACTIVE',
    actualCheckoutDate: null as Date | null,
    rentRefundableAmount: money('0'),
    items: [],
    contract: {
      id: 3,
      status: 'PENDING_CHECKOUT',
      startDate: new Date('2026-01-01'),
      endDate: new Date('2027-01-01'),
      bills: [bill(21, '2026-09-01')],
    },
  };
  const allocations = [allocation(1, '2026-09-01')];
  const deposit = { balanceAfter: money('1000') };
  const prepayment = { balanceAfter: money('200') };
  const writes = {
    deleteItems: jest.fn().mockResolvedValue({ count: 0 }),
    updateSettlement: jest.fn().mockResolvedValue({
      id: 8,
      items: [{ id: 91, itemType: 'RENT_REFUND' }],
    }),
    release: jest.fn().mockResolvedValue({ count: 0 }),
    reserve: jest.fn().mockResolvedValue({ count: 1 }),
  };
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    checkoutSettlement: {
      findUniqueOrThrow: jest
        .fn()
        .mockImplementation(() => Promise.resolve(settlement)),
      update: writes.updateSettlement,
    },
    checkoutSettlementItem: { deleteMany: writes.deleteItems },
    depositTransaction: {
      findFirst: jest.fn().mockImplementation(() => Promise.resolve(deposit)),
    },
    prepaymentTransaction: {
      findFirst: jest
        .fn()
        .mockImplementation(() => Promise.resolve(prepayment)),
    },
    paymentAllocation: {
      findMany: jest
        .fn()
        .mockImplementation(() => Promise.resolve(allocations)),
    },
    checkoutRentRefundAllocation: {
      findMany: jest.fn().mockResolvedValue([]),
      updateMany: writes.release,
      createMany: writes.reserve,
    },
  };
  const db = {
    ...tx,
    $transaction: jest.fn((callback: (client: typeof tx) => Promise<unknown>) =>
      callback(tx),
    ),
  };
  return {
    service: new CheckoutService({ db } as never),
    settlement,
    allocations,
    allocation,
    bill,
    deposit,
    prepayment,
    tx,
    writes,
  };
}

async function fingerprint(service: CheckoutService, dto = input()) {
  const preview = await service.preview(8, dto);
  return preview.previewFingerprint;
}

describe('checkout preview version', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-09-09T03:00:00Z'));
  });
  afterEach(() => jest.useRealTimers());

  it('returns a stateless SHA-256 version without any preview writes', async () => {
    const h = harness();
    expect(await fingerprint(h.service)).toMatch(/^[a-f0-9]{64}$/);
    for (const write of Object.values(h.writes))
      expect(write).not.toHaveBeenCalled();
    expect(h.tx.$queryRaw).not.toHaveBeenCalled();
  });

  it.each([undefined, '', 'tampered', '0'.repeat(64)])(
    'rejects missing or tampered version %p before any mutation',
    async (previewFingerprint) => {
      const h = harness();
      await expect(
        h.service.submit(8, { ...input(), previewFingerprint }, user),
      ).rejects.toThrow(new ConflictException(changedMessage));
      for (const write of Object.values(h.writes))
        expect(write).not.toHaveBeenCalled();
    },
  );

  it('rejects a first DRAFT submit after a later received allocation changes the refund plan', async () => {
    const h = harness();
    const previewFingerprint = await fingerprint(h.service);
    h.allocations.push(h.allocation(2, '2026-10-01'));
    h.settlement.contract.bills.push(h.bill(22, '2026-10-01'));
    await expect(
      h.service.submit(8, { ...input(), previewFingerprint }, user),
    ).rejects.toThrow(new ConflictException(changedMessage));
    for (const write of Object.values(h.writes))
      expect(write).not.toHaveBeenCalled();
  });

  const changes: Array<[string, (h: ReturnType<typeof harness>) => void]> = [
    [
      'saved actual date',
      (h) => {
        h.settlement.actualCheckoutDate = new Date('2026-09-02');
      },
    ],
    [
      'bill status',
      (h) => {
        h.settlement.contract.bills[0].status = 'VOIDED';
      },
    ],
    [
      'bill paid amount',
      (h) => {
        h.settlement.contract.bills[0].receivedAmount = money('199');
      },
    ],
    [
      'bill payable',
      (h) => {
        h.settlement.contract.bills[0].payableAmount = money('201');
      },
    ],
    [
      'bill period',
      (h) => {
        h.settlement.contract.bills[0].periodStart = new Date('2026-09-02');
      },
    ],
    [
      'deposit balance',
      (h) => {
        h.deposit.balanceAfter = money('999');
      },
    ],
    [
      'prepayment balance',
      (h) => {
        h.prepayment.balanceAfter = money('199');
      },
    ],
    [
      'reversed cash',
      (h) => {
        h.allocations[0].reversedAmount = money('10');
      },
    ],
    [
      'payment date ordering',
      (h) => {
        h.allocations[0].payment.paymentDate = new Date('2026-08-31');
      },
    ],
    [
      'pending cash refund',
      (h) => {
        h.allocations[0].refundAllocations.push({
          reversedAmount: money('10'),
        });
      },
    ],
    [
      'another checkout reservation',
      (h) => {
        h.allocations[0].checkoutRentRefundAllocations.push({
          reservedAmount: money('10'),
          item: { checkoutSettlementId: 9 },
        });
      },
    ],
    [
      'pending payment void',
      (h) => {
        h.allocations[0].payment.voidRequests.push({ id: 4 });
      },
    ],
  ];
  it.each(changes)(
    'rejects changed %s before any mutation',
    async (_label, change) => {
      const h = harness();
      const previewFingerprint = await fingerprint(h.service);
      change(h);
      await expect(
        h.service.submit(8, { ...input(), previewFingerprint }, user),
      ).rejects.toThrow(new ConflictException(changedMessage));
      for (const write of Object.values(h.writes))
        expect(write).not.toHaveBeenCalled();
    },
  );

  it('binds the version to request dates and item amounts', async () => {
    const h = harness();
    const previewFingerprint = await fingerprint(h.service);
    const dto = input();
    dto.items[0].amount = '101.00';
    await expect(
      h.service.submit(8, { ...dto, previewFingerprint }, user),
    ).rejects.toThrow(new ConflictException(changedMessage));
    for (const write of Object.values(h.writes))
      expect(write).not.toHaveBeenCalled();
  });

  it('is stable across database row order and unrelated timestamps', async () => {
    const h = harness();
    h.allocations.push(h.allocation(2, '2026-10-01'));
    h.settlement.contract.bills.push(h.bill(22, '2026-10-01'));
    const original = await fingerprint(h.service);
    h.allocations.reverse();
    h.settlement.contract.bills.reverse();
    Object.assign(h.settlement, { updatedAt: new Date() });
    jest.setSystemTime(new Date('2026-09-09T04:00:00Z'));
    expect(await fingerprint(h.service)).toBe(original);
  });

  it('accepts a current version only after locked accounting reads and reserves the reviewed allocation', async () => {
    const h = harness();
    const previewFingerprint = await fingerprint(h.service);
    await h.service.submit(8, { ...input(), previewFingerprint }, user);
    expect(h.writes.reserve).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          paymentAllocationId: 1,
          rentBillId: 21,
          reservedAmount: money('100'),
        }),
      ],
    });
    const sql = h.tx.$queryRaw.mock.calls.map(([query]: [Prisma.Sql]) =>
      query.strings.join('?'),
    );
    for (const table of [
      'contracts',
      'checkout_settlements',
      'rent_bills',
      'deposit_transactions',
      'prepayment_transactions',
      'payments',
      'payment_allocations',
    ]) {
      expect(
        sql.some(
          (statement) =>
            statement.includes(`FROM ${table} `) &&
            statement.includes('FOR UPDATE'),
        ),
      ).toBe(true);
    }
    expect(
      h.tx.depositTransaction.findFirst.mock.invocationCallOrder.at(-1),
    ).toBeLessThan(h.writes.deleteItems.mock.invocationCallOrder[0]);
  });
});
