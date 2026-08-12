import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CheckoutService } from './checkout.service';

describe('CheckoutService', () => {
  const user = { id: 2, username: 'admin', role: 'ADMIN' } as const;

  it('lists only completed settlements whose contracts are ended', async () => {
    const findMany = jest.fn().mockResolvedValue([
      {
        id: 9,
        settlementNo: 'TZ202608120001',
        actualCheckoutDate: new Date('2026-08-11'),
        contract: {
          contractNo: 'HT202608010001 | 2栋301 | 李四',
          room: { id: 7, fullHouseNo: '2栋301' },
          members: [{ tenant: { name: '李四' } }],
        },
        depositRefunds: [],
      },
    ]);
    const service = new CheckoutService({
      db: {
        checkoutSettlement: { findMany, count: jest.fn().mockResolvedValue(1) },
        roomStatusHistory: {
          findMany: jest.fn().mockResolvedValue([
            {
              businessType: 'CHECKOUT',
              businessId: 9,
              toStatus: 'EMPTY',
              changedAt: new Date('2026-08-12T10:00:00.000Z'),
            },
            {
              businessType: 'CHECKOUT',
              businessId: 9,
              toStatus: 'PENDING_CHECKOUT',
              changedAt: new Date('2026-08-10T10:00:00.000Z'),
            },
          ]),
        },
      },
    } as never);

    await expect(
      service.listCompletedContracts({ page: 1, pageSize: 20 }),
    ).resolves.toEqual({
      items: [
        {
          settlementId: 9,
          settlementNo: 'TZ202608120001',
          contractNo: 'HT202608010001 | 2栋301 | 李四',
          roomFullHouseNo: '2栋301',
          tenantName: '李四',
          actualCheckoutDate: new Date('2026-08-11'),
          refundAmount: '0.00',
          completedAt: new Date('2026-08-12T10:00:00.000Z'),
        },
      ],
      page: 1,
      pageSize: 20,
      total: 1,
    });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: 'COMPLETED', contract: { status: 'ENDED' } },
      }),
    );
  });

  it('searches completed contracts by contract number, room number, or tenant name', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const service = new CheckoutService({
      db: {
        checkoutSettlement: { findMany, count: jest.fn().mockResolvedValue(0) },
        roomStatusHistory: { findMany: jest.fn() },
      },
    } as never);

    await service.listCompletedContracts({
      keyword: '2栋301',
      page: 1,
      pageSize: 20,
    });

    expect(findMany.mock.calls[0][0].where.contract).toEqual({
      status: 'ENDED',
      OR: [
        { contractNo: { contains: '2栋301' } },
        { room: { fullHouseNo: { contains: '2栋301' } } },
        {
          members: {
            some: {
              isCurrent: true,
              tenant: { name: { contains: '2栋301' } },
            },
          },
        },
      ],
    });
  });

  it('serializes approved combined refunds and zero refunds with two decimals', async () => {
    const service = new CheckoutService({
      db: {
        checkoutSettlement: {
          findMany: jest.fn().mockResolvedValue([
            {
              id: 9,
              settlementNo: 'TZPOSITIVE',
              actualCheckoutDate: new Date('2026-08-11'),
              contract: {
                contractNo: 'HTPOSITIVE',
                room: { id: 7, fullHouseNo: '2栋301' },
                members: [{ tenant: { name: '李四' } }],
              },
              depositRefunds: [
                { id: 90, refundAmount: new Prisma.Decimal('800') },
                { id: 91, refundAmount: new Prisma.Decimal('500') },
              ],
            },
            {
              id: 10,
              settlementNo: 'TZZERO',
              actualCheckoutDate: new Date('2026-08-10'),
              contract: {
                contractNo: 'HTZERO',
                room: { id: 8, fullHouseNo: '2栋302' },
                members: [{ tenant: { name: '王五' } }],
              },
              depositRefunds: [],
            },
          ]),
          count: jest.fn().mockResolvedValue(2),
        },
        roomStatusHistory: {
          findMany: jest.fn().mockResolvedValue([
            {
              businessType: 'DEPOSIT_REFUND',
              businessId: 90,
              changedAt: new Date('2026-08-12T11:00:00.000Z'),
            },
            {
              businessType: 'DEPOSIT_REFUND',
              businessId: 91,
              changedAt: new Date('2026-08-12T11:00:00.000Z'),
            },
            {
              businessType: 'CHECKOUT',
              businessId: 10,
              changedAt: new Date('2026-08-12T12:00:00.000Z'),
            },
          ]),
        },
      },
    } as never);

    await expect(
      service.listCompletedContracts({ page: 1, pageSize: 20 }),
    ).resolves.toMatchObject({
      items: [
        {
          refundAmount: '1300.00',
          completedAt: new Date('2026-08-12T11:00:00.000Z'),
        },
        {
          refundAmount: '0.00',
          completedAt: new Date('2026-08-12T12:00:00.000Z'),
        },
      ],
    });
  });

  it('cancels a draft checkout settlement and restores contract and original room status', async () => {
    const settlementUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
    const contractUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
    const roomUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
    const historyCreate = jest.fn();
    const tx = {
      checkoutSettlement: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 1,
          status: 'DRAFT',
          contractId: 3,
          contract: {
            id: 3,
            status: 'PENDING_CHECKOUT',
            roomId: 7,
            room: { id: 7, roomStatus: 'PENDING_CHECKOUT' },
          },
        }),
        updateMany: settlementUpdateMany,
        findUnique: jest.fn().mockResolvedValue({ id: 1, status: 'CANCELLED' }),
      },
      roomStatusHistory: {
        findFirst: jest.fn().mockResolvedValue({ fromStatus: 'RENTED' }),
        create: historyCreate,
      },
      contract: { updateMany: contractUpdateMany },
      room: { updateMany: roomUpdateMany },
    };
    const service = new CheckoutService({
      db: {
        $transaction: jest.fn(
          (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
        ),
      },
    } as never);

    await expect(service.cancel(1, user)).resolves.toEqual({
      id: 1,
      status: 'CANCELLED',
    });
    expect(settlementUpdateMany).toHaveBeenCalledWith({
      where: { id: 1, status: { in: ['DRAFT', 'PENDING', 'REJECTED'] } },
      data: { status: 'CANCELLED' },
    });
    expect(contractUpdateMany).toHaveBeenCalledWith({
      where: { id: 3, status: 'PENDING_CHECKOUT' },
      data: { status: 'ACTIVE' },
    });
    expect(roomUpdateMany).toHaveBeenCalledWith({
      where: { id: 7, roomStatus: 'PENDING_CHECKOUT' },
      data: { roomStatus: 'RENTED', statusChangedAt: expect.any(Date) },
    });
    expect(historyCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        roomId: 7,
        fromStatus: 'PENDING_CHECKOUT',
        toStatus: 'RENTED',
        changeReason: '取消退租结算',
        businessType: 'CHECKOUT',
        businessId: 1,
        changedBy: user.id,
      }),
    });
  });

  it('rejects cancelling an approved settlement before restoring contract or room', async () => {
    const contractUpdateMany = jest.fn();
    const roomUpdateMany = jest.fn();
    const tx = {
      checkoutSettlement: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 1,
          status: 'APPROVED',
          contract: {
            status: 'PENDING_CHECKOUT',
            room: { roomStatus: 'PENDING_CHECKOUT' },
          },
        }),
      },
      contract: { updateMany: contractUpdateMany },
      room: { updateMany: roomUpdateMany },
    };
    const service = new CheckoutService({
      db: {
        $transaction: jest.fn(
          (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
        ),
      },
    } as never);

    await expect(service.cancel(1, user)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(contractUpdateMany).not.toHaveBeenCalled();
    expect(roomUpdateMany).not.toHaveBeenCalled();
  });


  it('lists approved settlements separately for final refund confirmation', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const service = new CheckoutService({
      db: { checkoutSettlement: { findMany } },
    } as never);

    await service.listRefundPending();

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          status: 'APPROVED',
          contract: { status: 'PENDING_CHECKOUT' },
        },
      }),
    );
  });

  it('lists only actionable checkout settlements by default', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const service = new CheckoutService({
      db: { checkoutSettlement: { findMany } },
    } as never);

    await service.list();

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: { in: ['DRAFT', 'PENDING', 'REJECTED'] } },
      }),
    );
  });
  it('returns a rejected settlement to draft without deleting its items', async () => {
    const update = jest.fn().mockResolvedValue({ id: 1, status: 'DRAFT' });
    const service = new CheckoutService({
      db: {
        checkoutSettlement: {
          findUniqueOrThrow: jest.fn().mockResolvedValue({
            id: 1,
            status: 'REJECTED',
            items: [{ id: 1, amount: '500' }],
          }),
          update,
        },
      },
    } as never);

    await expect(service.returnToDraft(1, user)).resolves.toEqual({
      id: 1,
      status: 'DRAFT',
    });
    expect(update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { status: 'DRAFT' },
    });
  });

  it('rejects returning a settlement that was not rejected', async () => {
    const service = new CheckoutService({
      db: {
        checkoutSettlement: {
          findUniqueOrThrow: jest
            .fn()
            .mockResolvedValue({ id: 1, status: 'PENDING' }),
        },
      },
    } as never);

    await expect(service.returnToDraft(1, user)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
  it('keeps contract and room pending checkout after settlement approval', async () => {
    const contractUpdate = jest.fn();
    const roomUpdate = jest.fn();
    const tx = {
      checkoutSettlement: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 1,
          contractId: 3,
          status: 'PENDING',
          actualCheckoutDate: new Date('2026-08-01'),
          items: [],
          contract: { room: { id: 7 }, bills: [] },
        }),
        update: jest.fn().mockResolvedValue({ id: 1, status: 'APPROVED' }),
      },
      contract: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 3, roomId: 7 }),
        update: contractUpdate,
      },
      room: { update: roomUpdate },
      roomStatusHistory: { create: jest.fn() },
      rentBill: { update: jest.fn(), updateMany: jest.fn() },
      depositTransaction: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn(),
      },
      prepaymentTransaction: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const service = new CheckoutService({
      db: {
        $transaction: jest.fn(
          (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
        ),
      },
    } as never);

    await service.approve(1, { ...user, role: 'SUPER_ADMIN' });

    expect(contractUpdate).not.toHaveBeenCalled();
    expect(roomUpdate).not.toHaveBeenCalled();
  });
  it('completes an approved zero-refund settlement only after final confirmation', async () => {
    const settlementUpdate = jest.fn().mockResolvedValue({
      id: 1,
      status: 'COMPLETED',
    });
    const contractUpdate = jest.fn();
    const roomUpdate = jest.fn();
    const tx = {
      checkoutSettlement: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 1,
          contractId: 3,
          status: 'APPROVED',
          targetRoomStatus: 'EMPTY',
          depositRefundableAmount: '0.00',
          prepaymentRefundableAmount: '0.00',
          finalReceivable: '0.00',
          contract: { id: 3, status: 'PENDING_CHECKOUT', roomId: 7 },
        }),
        update: settlementUpdate,
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      contract: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 3, roomId: 7 }),
        update: contractUpdate,
      },
      room: { update: roomUpdate },
      roomStatusHistory: { create: jest.fn() },
    };
    const service = new CheckoutService({
      db: {
        $transaction: jest.fn(
          (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
        ),
      },
    } as never);

    await service.completeZeroRefund(1, {
      ...user,
      role: 'SUPER_ADMIN',
    });

    expect(settlementUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'COMPLETED' } }),
    );
    expect(contractUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'ENDED' } }),
    );
    expect(roomUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ roomStatus: 'EMPTY' }),
      }),
    );
  });

  it('rejects zero final confirmation when a locked amount is non-zero', async () => {
    const tx = {
      checkoutSettlement: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 1,
          status: 'APPROVED',
          depositRefundableAmount: '0.00',
          prepaymentRefundableAmount: '500.00',
          finalReceivable: '0.00',
          contract: { status: 'PENDING_CHECKOUT' },
        }),
      },
    };
    const service = new CheckoutService({
      db: {
        $transaction: jest.fn(
          (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
        ),
      },
    } as never);

    await expect(
      service.completeZeroRefund(1, { ...user, role: 'SUPER_ADMIN' }),
    ).rejects.toThrow('零额最终确认条件不满足');
  });
  it('returns settlement detail with contract room, items and locked refund components', async () => {
    const service = new CheckoutService({
      db: {
        checkoutSettlement: {
          findUniqueOrThrow: jest.fn().mockResolvedValue({
            id: 1,
            rentReceivable: new Prisma.Decimal('0.00'),
            rentReceived: new Prisma.Decimal('0.00'),
            rentOutstanding: new Prisma.Decimal('0.00'),
            prepaymentBalance: new Prisma.Decimal('500.00'),
            depositBalance: new Prisma.Decimal('800.00'),
            depositOffsetAmount: new Prisma.Decimal('0.00'),
            otherDeductionAmount: new Prisma.Decimal('0.00'),
            depositRefundableAmount: new Prisma.Decimal('800.00'),
            prepaymentRefundableAmount: new Prisma.Decimal('500.00'),
            finalReceivable: new Prisma.Decimal('0.00'),
            contract: { id: 3, room: { id: 7, roomNo: '301' } },
            items: [{ id: 1, amount: new Prisma.Decimal('120.00') }],
            depositRefunds: [
              { id: 9, refundAmount: new Prisma.Decimal('1300.00') },
            ],
          }),
        },
      },
    } as never);

    await expect(service.getDetail(1)).resolves.toMatchObject({
      id: 1,
      depositRefundableAmount: '800.00',
      prepaymentRefundableAmount: '500.00',
      finalReceivable: '0.00',
      contract: { room: { roomNo: '301' } },
      items: [{ amount: '120.00' }],
      depositRefunds: [{ refundAmount: '1300.00' }],
    });
  });

  it('rejects a zero-refund confirmation when another confirmation already claimed the settlement', async () => {
    const contractUpdate = jest.fn();
    const tx = {
      checkoutSettlement: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 1,
          contractId: 3,
          status: 'APPROVED',
          targetRoomStatus: 'EMPTY',
          depositRefundableAmount: '0.00',
          prepaymentRefundableAmount: '0.00',
          finalReceivable: '0.00',
          contract: { id: 3, status: 'PENDING_CHECKOUT', roomId: 7 },
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      contract: { findUniqueOrThrow: jest.fn(), update: contractUpdate },
      room: { update: jest.fn() },
      roomStatusHistory: { create: jest.fn() },
    };
    const service = new CheckoutService({
      db: {
        $transaction: jest.fn(
          (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
        ),
      },
    } as never);

    await expect(
      service.completeZeroRefund(1, { ...user, role: 'SUPER_ADMIN' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(contractUpdate).not.toHaveBeenCalled();
  });
  it('returns a read-only checkout finance snapshot from current balances and bills', async () => {
    const service = new CheckoutService({
      db: {
        contract: {
          findUniqueOrThrow: jest.fn().mockResolvedValue({
            id: 3,
            bills: [
              {
                periodStart: new Date('2026-08-01'),
                outstandingAmount: '120.00',
                status: 'PARTIAL',
              },
              {
                periodStart: new Date('2026-09-01'),
                outstandingAmount: '300.00',
                status: 'UNPAID',
              },
              {
                periodStart: new Date('2026-07-01'),
                outstandingAmount: '0.00',
                status: 'PAID',
              },
            ],
          }),
        },
        depositTransaction: {
          findFirst: jest.fn().mockResolvedValue({ balanceAfter: '800.00' }),
        },
        prepaymentTransaction: {
          findFirst: jest.fn().mockResolvedValue({ balanceAfter: '500.00' }),
        },
      },
    } as never);

    await expect(
      service.getFinanceSnapshot(3, new Date('2026-08-15')),
    ).resolves.toEqual({
      depositBalance: '800.00',
      rentOutstanding: '120.00',
      prepaymentBalance: '500.00',
      futureBillCount: 1,
    });
  });
});
