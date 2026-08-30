import { Prisma } from '@prisma/client';
import {
  assertCheckoutRentRefundReservationMatches,
  assertNoCheckoutRentRefundReservation,
  releaseCheckoutRentRefund,
  reserveCheckoutRentRefund,
} from './checkout-rent-refund-reservations';

const allocation = (overrides: Record<string, unknown> = {}) => ({
  id: 101,
  paymentId: 11,
  rentBillId: 21,
  allocatedAmount: new Prisma.Decimal('1000.00'),
  reversedAmount: new Prisma.Decimal('100.00'),
  payment: {
    paymentDate: new Date('2026-08-05'),
    voidRequests: [],
  },
  rentBill: {
    billNo: 'ZJ2026080001',
    periodStart: new Date('2026-08-01'),
    periodEnd: new Date('2026-08-31'),
  },
  refundAllocations: [{ reversedAmount: new Prisma.Decimal('200.00') }],
  checkoutRentRefundAllocations: [
    {
      reservedAmount: new Prisma.Decimal('250.00'),
      item: { checkoutSettlementId: 9 },
    },
    {
      reservedAmount: new Prisma.Decimal('100.00'),
      item: { checkoutSettlementId: 10 },
    },
  ],
  ...overrides,
});

const reservationTx = (allocations = [allocation()]) => ({
  $queryRaw: jest.fn().mockResolvedValue([]),
  paymentAllocation: { findMany: jest.fn().mockResolvedValue(allocations) },
  checkoutRentRefundAllocation: {
    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    createMany: jest.fn().mockResolvedValue({ count: 1 }),
    findFirst: jest.fn().mockResolvedValue(null),
    findMany: jest.fn().mockResolvedValue([]),
  },
});

describe('checkout rent refund reservations', () => {
  it('locks availability in stable id order, releases its old rows, and creates fresh reservations', async () => {
    const tx = reservationTx([
      allocation(),
      allocation({
        id: 102,
        paymentId: 12,
        rentBillId: 22,
        allocatedAmount: new Prisma.Decimal('500.00'),
        reversedAmount: new Prisma.Decimal('0.00'),
        payment: {
          paymentDate: new Date('2026-08-06'),
          voidRequests: [{ id: 301 }],
        },
        rentBill: {
          billNo: 'ZJ2026090001',
          periodStart: new Date('2026-09-01'),
          periodEnd: new Date('2026-09-30'),
        },
        refundAllocations: [],
        checkoutRentRefundAllocations: [],
      }),
    ]);

    await expect(
      reserveCheckoutRentRefund(tx as never, {
        settlementId: 9,
        settlementItemId: 81,
        contractId: 4,
        actualCheckoutDate: new Date('2026-08-15'),
        requestedAmount: '600.00',
      }),
    ).resolves.toMatchObject({
      maxRefundableAmount: '600.00',
      requestedAmount: '600.00',
    });

    expect(tx.checkoutRentRefundAllocation.updateMany).toHaveBeenCalledWith({
      where: {
        status: 'RESERVED',
        item: { checkoutSettlementId: 9 },
      },
      data: { status: 'RELEASED', releasedAt: expect.any(Date) },
    });
    expect(tx.checkoutRentRefundAllocation.createMany).toHaveBeenCalledWith({
      data: [
        {
          checkoutSettlementItemId: 81,
          paymentAllocationId: 101,
          paymentId: 11,
          rentBillId: 21,
          reservedAmount: new Prisma.Decimal('600.00'),
          status: 'RESERVED',
        },
      ],
    });
    expect(
      tx.checkoutRentRefundAllocation.updateMany.mock.invocationCallOrder[0],
    ).toBeLessThan(
      tx.checkoutRentRefundAllocation.createMany.mock.invocationCallOrder[0],
    );

    const lockSql = tx.$queryRaw.mock.calls
      .map(([sql]) =>
        (sql as { strings?: readonly string[] }).strings?.join('?'),
      )
      .filter((sql): sql is string => Boolean(sql));
    const lockValues = tx.$queryRaw.mock.calls.map(
      ([sql]) => (sql as { values?: readonly unknown[] }).values,
    );
    expect(
      lockSql.slice(0, 6).map((sql) => ({
        ordered: /ORDER BY [a-z]+\.id FOR UPDATE/.test(sql),
        table: [
          'rent_bills',
          'payments',
          'payment_allocations',
          'payment_refund_allocations',
          'payment_void_requests',
          'checkout_rent_refund_allocations',
        ].find((name) => sql.includes(`FROM ${name} `)),
      })),
    ).toEqual([
      { ordered: true, table: 'rent_bills' },
      { ordered: true, table: 'payments' },
      { ordered: true, table: 'payment_allocations' },
      { ordered: true, table: 'payment_refund_allocations' },
      { ordered: true, table: 'payment_void_requests' },
      { ordered: true, table: 'checkout_rent_refund_allocations' },
    ]);
    expect(lockValues.slice(0, 6)).toEqual([[4], [4], [4], [4], [4], [4]]);
    expect(lockSql[3]).toContain("pr.approval_status = 'PENDING'");
    expect(lockSql[4]).toContain("pvr.approval_status = 'PENDING'");
    expect(lockSql[5]).toContain("crra.status = 'RESERVED'");
    expect(lockValues[6]).toEqual([9]);
    expect(tx.paymentAllocation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          payment: {
            select: {
              paymentDate: true,
              voidRequests: {
                where: { approvalStatus: 'PENDING' },
                select: { id: true },
              },
            },
          },
        }),
      }),
    );
  });

  it('does not create partial reservations when locked availability is insufficient', async () => {
    const tx = reservationTx();

    await expect(
      reserveCheckoutRentRefund(tx as never, {
        settlementId: 9,
        settlementItemId: 81,
        contractId: 4,
        actualCheckoutDate: new Date('2026-08-15'),
        requestedAmount: '600.01',
      }),
    ).rejects.toThrow('退还租金不能超过当前可回冲金额 ¥600.00。');
    expect(tx.checkoutRentRefundAllocation.createMany).not.toHaveBeenCalled();
  });

  it('subtracts every pending refund across multiple payment allocations', async () => {
    const tx = reservationTx([
      allocation({
        refundAllocations: [
          { reversedAmount: new Prisma.Decimal('150.00') },
          { reversedAmount: new Prisma.Decimal('50.00') },
        ],
        checkoutRentRefundAllocations: [],
      }),
      allocation({
        id: 102,
        paymentId: 12,
        rentBillId: 22,
        allocatedAmount: new Prisma.Decimal('500.00'),
        reversedAmount: new Prisma.Decimal('0.00'),
        payment: {
          paymentDate: new Date('2026-08-06'),
          voidRequests: [],
        },
        rentBill: {
          billNo: 'ZJ2026090001',
          periodStart: new Date('2026-09-01'),
          periodEnd: new Date('2026-09-30'),
        },
        refundAllocations: [
          { reversedAmount: new Prisma.Decimal('25.00') },
          { reversedAmount: new Prisma.Decimal('75.00') },
        ],
        checkoutRentRefundAllocations: [],
      }),
    ]);

    await reserveCheckoutRentRefund(tx as never, {
      settlementId: 9,
      settlementItemId: 81,
      contractId: 4,
      actualCheckoutDate: new Date('2026-08-15'),
      requestedAmount: '1000.00',
    });

    expect(tx.checkoutRentRefundAllocation.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          paymentAllocationId: 102,
          reservedAmount: new Prisma.Decimal('400.00'),
        }),
        expect.objectContaining({
          paymentAllocationId: 101,
          reservedAmount: new Prisma.Decimal('600.00'),
        }),
      ],
    });
  });

  it('releases reservations idempotently and stamps the release time', async () => {
    const tx = reservationTx();
    tx.checkoutRentRefundAllocation.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      releaseCheckoutRentRefund(tx as never, 9, '退回草稿'),
    ).resolves.toEqual({ count: 0 });
    expect(tx.checkoutRentRefundAllocation.updateMany).toHaveBeenCalledWith({
      where: {
        status: 'RESERVED',
        item: { checkoutSettlementId: 9 },
      },
      data: { status: 'RELEASED', releasedAt: expect.any(Date) },
    });
  });

  it('rejects a payment reversal that touches an active reservation', async () => {
    const tx = reservationTx();
    tx.checkoutRentRefundAllocation.findFirst.mockResolvedValue({ id: 501 });

    await expect(
      assertNoCheckoutRentRefundReservation(tx as never, 11),
    ).rejects.toThrow('相关租金已被退租退款流程占用，不能重复退款或作废。');
    expect(tx.checkoutRentRefundAllocation.findFirst).toHaveBeenCalledWith({
      where: { paymentId: 11, status: 'RESERVED' },
      select: { id: true },
    });
    const guardSql = tx.$queryRaw.mock.calls[0][0] as {
      strings?: readonly string[];
      values?: readonly unknown[];
    };
    expect(guardSql.strings?.join('?')).toContain("crra.status = 'RESERVED'");
    expect(guardSql.values).toEqual([11]);
  });

  it('allows a payment reversal when only historical reservations remain', async () => {
    const tx = reservationTx();

    await expect(
      assertNoCheckoutRentRefundReservation(tx as never, 11),
    ).resolves.toBeUndefined();
  });

  it('rejects approval when reserved detail has been tampered with', async () => {
    const tx = reservationTx();
    tx.checkoutRentRefundAllocation.findMany.mockResolvedValue([
      {
        id: 501,
        paymentAllocationId: 101,
        paymentId: 11,
        rentBillId: 21,
        reservedAmount: new Prisma.Decimal('599.99'),
        item: {
          checkoutSettlementId: 9,
          itemType: 'RENT_REFUND',
          amount: new Prisma.Decimal('600.00'),
        },
        paymentAllocation: { paymentId: 11, rentBillId: 21 },
      },
    ]);

    await expect(
      assertCheckoutRentRefundReservationMatches(tx as never, 9, '600.00'),
    ).rejects.toThrow('退租退款预留明细已变化，请退回草稿后重新提交。');
  });
});
