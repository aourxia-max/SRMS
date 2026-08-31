import { Prisma } from '@prisma/client';
import {
  normalizeFutureCheckoutBills,
  reverseFutureCheckoutBillNormalization,
} from './checkout-future-bill-normalization';

const at = new Date('2026-08-31T12:00:00.000Z');
const input = {
  settlementId: 107,
  contractId: 75,
  actualCheckoutDate: new Date('2026-08-13T00:00:00.000Z'),
  operatorId: 1,
  occurredAt: at,
};

function futureBill(overrides: Record<string, unknown> = {}) {
  return {
    id: 260,
    billNo: 'ZD260',
    contractId: 75,
    periodStart: new Date('2026-08-20T00:00:00.000Z'),
    periodEnd: new Date('2026-09-19T00:00:00.000Z'),
    dueDate: new Date('2026-08-20T00:00:00.000Z'),
    adjustmentAmount: new Prisma.Decimal('0.00'),
    payableAmount: new Prisma.Decimal('800.00'),
    receivedAmount: new Prisma.Decimal('300.00'),
    outstandingAmount: new Prisma.Decimal('500.00'),
    status: 'PARTIAL',
    billCategory: 'RENT',
    ...overrides,
  };
}

function harness(bills = [futureBill()]) {
  let adjustmentId = 1000;
  return {
    tx: {
      $queryRaw: jest.fn().mockResolvedValue([]),
      rentBill: {
        findMany: jest.fn().mockResolvedValue(bills),
        update: jest.fn().mockResolvedValue({}),
      },
      billAdjustment: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest
          .fn()
          .mockImplementation(({ data }) =>
            Promise.resolve({ id: adjustmentId++, ...data }),
          ),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    },
  };
}

describe('future checkout bill normalization', () => {
  it('turns an 800/300/500 future bill into 300/300/0 with an approved correction', async () => {
    const { tx } = harness();

    const result = await normalizeFutureCheckoutBills(tx as never, input);

    expect(result).toEqual({
      normalizedBillIds: [260],
      cancelledOutstandingAmount: '500.00',
    });
    expect(tx.rentBill.update).toHaveBeenCalledWith({
      where: { id: 260 },
      data: {
        adjustmentAmount: new Prisma.Decimal('-500.00'),
        payableAmount: new Prisma.Decimal('300.00'),
        outstandingAmount: new Prisma.Decimal('0.00'),
        status: 'PAID',
      },
    });
    expect(tx.billAdjustment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        rentBillId: 260,
        adjustmentType: 'CORRECTION',
        direction: 'DECREASE',
        amount: new Prisma.Decimal('500.00'),
        beforeAmount: new Prisma.Decimal('800.00'),
        afterAmount: new Prisma.Decimal('300.00'),
        reason: '退租结算 107 核销未来未收租金',
        approvalStatus: 'APPROVED',
        submittedBy: 1,
        approvedBy: 1,
      }),
    });
  });

  it('voids a wholly unpaid future bill', async () => {
    const { tx } = harness([
      futureBill({
        receivedAmount: new Prisma.Decimal('0.00'),
        outstandingAmount: new Prisma.Decimal('800.00'),
        status: 'PENDING',
      }),
    ]);

    await normalizeFutureCheckoutBills(tx as never, input);

    expect(tx.rentBill.update).toHaveBeenCalledWith({
      where: { id: 260 },
      data: expect.objectContaining({
        payableAmount: new Prisma.Decimal('0.00'),
        outstandingAmount: new Prisma.Decimal('0.00'),
        status: 'VOIDED',
      }),
    });
  });

  it('is idempotent when every future bill already has zero outstanding', async () => {
    const { tx } = harness([
      futureBill({
        payableAmount: new Prisma.Decimal('300.00'),
        outstandingAmount: new Prisma.Decimal('0.00'),
        status: 'PAID',
      }),
    ]);

    const result = await normalizeFutureCheckoutBills(tx as never, input);

    expect(result).toEqual({
      normalizedBillIds: [],
      cancelledOutstandingAmount: '0.00',
    });
    expect(tx.rentBill.update).not.toHaveBeenCalled();
    expect(tx.billAdjustment.create).not.toHaveBeenCalled();
  });

  it('reverses only active corrections created by this checkout', async () => {
    const bill = futureBill({
      adjustmentAmount: new Prisma.Decimal('-500.00'),
      payableAmount: new Prisma.Decimal('300.00'),
      outstandingAmount: new Prisma.Decimal('0.00'),
      status: 'PAID',
    });
    const { tx } = harness([]);
    tx.billAdjustment.findMany.mockResolvedValue([
      {
        id: 900,
        rentBillId: 260,
        amount: new Prisma.Decimal('500.00'),
        reason: '退租结算 107 核销未来未收租金',
        approvedAt: at,
        rentBill: bill,
      },
    ]);

    const result = await reverseFutureCheckoutBillNormalization(
      tx as never,
      input,
    );

    expect(result).toEqual({
      restoredBillIds: [260],
      restoredOutstandingAmount: '500.00',
    });
    expect(tx.rentBill.update).toHaveBeenCalledWith({
      where: { id: 260 },
      data: {
        adjustmentAmount: new Prisma.Decimal('0.00'),
        payableAmount: new Prisma.Decimal('800.00'),
        outstandingAmount: new Prisma.Decimal('500.00'),
        status: 'PARTIAL',
      },
    });
    expect(tx.billAdjustment.updateMany).toHaveBeenCalledWith({
      where: { id: 900, reversedByAdjustmentId: null },
      data: { reversedByAdjustmentId: 1000 },
    });
  });
});
