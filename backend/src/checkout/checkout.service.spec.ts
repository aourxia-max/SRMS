import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CheckoutService } from './checkout.service';

function transactional<T extends object>(tx: T) {
  const client = {
    $queryRaw: jest.fn().mockResolvedValue([{ id: 1 }]),
    checkoutRentRefundAllocation: {
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    ...tx,
  };
  return {
    client,
    db: {
      ...client,
      $transaction: jest.fn(
        (callback: (value: typeof client) => Promise<unknown>) =>
          callback(client),
      ),
    },
  };
}

function expectContractMutationOrder(
  entry: string,
  contractLock: jest.Mock,
  reload: jest.Mock,
  firstWrite: jest.Mock,
  reloadCallIndex = -1,
) {
  const lockIndex = contractLock.mock.calls.findIndex(([query]) => {
    const statement =
      (query as { strings?: readonly string[] }).strings?.join('?') ?? '';
    return (
      statement.includes('FROM contracts') && statement.includes('FOR UPDATE')
    );
  });
  const sql = contractLock.mock.calls[lockIndex]?.[0] as
    { strings?: readonly string[] } | undefined;
  const statement = sql?.strings?.join('?') ?? '';
  const lockOrder = contractLock.mock.invocationCallOrder[lockIndex];
  const reloadOrder =
    reloadCallIndex === -1
      ? reload.mock.invocationCallOrder.at(-1)
      : reload.mock.invocationCallOrder[reloadCallIndex];
  const writeOrder = firstWrite.mock.invocationCallOrder[0];
  expect({
    entry,
    locksContractForUpdate:
      statement.includes('FROM contracts') && statement.includes('FOR UPDATE'),
    lockBeforeReload: lockOrder < reloadOrder!,
    reloadBeforeFirstWrite: reloadOrder! < writeOrder,
  }).toEqual({
    entry,
    locksContractForUpdate: true,
    lockBeforeReload: true,
    reloadBeforeFirstWrite: true,
  });
}

function expectRoomBeforeTargetContractLock(queryRaw: jest.Mock) {
  const queries = queryRaw.mock.calls.map(([query], index) => ({
    statement:
      (query as { strings?: readonly string[] }).strings?.join('?') ?? '',
    callOrder: queryRaw.mock.invocationCallOrder[index],
  }));
  const roomLock = queries.find(
    ({ statement }) =>
      statement.includes('FROM rooms') && statement.includes('FOR UPDATE'),
  );
  const contractLock = queries.find(
    ({ statement }) =>
      statement.includes('FROM contracts') && statement.includes('FOR UPDATE'),
  );

  expect(roomLock?.callOrder).toBeLessThan(contractLock?.callOrder ?? 0);
}
function mockRoomContractLocks(
  tx: { $queryRaw: jest.Mock; contract?: Record<string, unknown> },
  contractId: number,
  roomId: number,
) {
  tx.contract ??= {};
  tx.contract.findUnique = jest
    .fn()
    .mockResolvedValue({ id: contractId, roomId });
  tx.$queryRaw.mockImplementation((query: { strings?: readonly string[] }) => {
    const statement = query.strings?.join('?') ?? '';
    if (statement.includes('FROM rooms')) return [{ id: roomId }];
    if (statement.includes('FROM contracts')) {
      return [{ id: contractId, roomId }];
    }
    return [{ id: 1 }];
  });
}

describe('CheckoutService', () => {
  const user = { id: 2, username: 'admin', role: 'ADMIN' } as const;

  it('allows a pending-start contract to initiate checkout and records its original status', async () => {
    const settlementCreate = jest.fn().mockResolvedValue({ id: 19 });
    const contractUpdate = jest.fn();
    const roomUpdate = jest.fn();
    const historyCreate = jest.fn();
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 1 }]),
      contract: {
        findUnique: jest.fn().mockResolvedValue({ id: 3, roomId: 7 }),
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 3,
          status: 'PENDING_START',
          roomId: 7,
          room: { id: 7, roomStatus: 'WAITING_MOVE_IN' },
        }),
        update: contractUpdate,
      },
      checkoutSettlement: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: settlementCreate,
      },
      room: { update: roomUpdate },
      roomStatusHistory: { create: historyCreate },
    };
    mockRoomContractLocks(tx, 3, 7);
    const transaction = jest.fn(
      (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
    );
    const service = new CheckoutService({
      db: {
        $transaction: transaction,
      },
    } as never);

    await expect(
      service.initiate(
        3,
        {
          checkoutType: '未入住退租',
          plannedCheckoutDate: '2026-08-20',
          handoverDate: '2026-08-20',
          inspectionAt: '2026-08-20T09:00:00.000Z',
          checkoutReason: '未入住前取消租赁',
          targetRoomStatus: 'EMPTY',
        } as never,
        user,
      ),
    ).resolves.toEqual({ id: 19 });
    expect(settlementCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        contractId: 3,
        checkoutType: '未入住退租',
        originContractStatus: 'PENDING_START',
      }),
    });
    expect(contractUpdate).toHaveBeenCalledWith({
      where: { id: 3 },
      data: { status: 'PENDING_CHECKOUT' },
    });
    expect(roomUpdate).toHaveBeenCalledWith({
      where: { id: 7 },
      data: {
        roomStatus: 'PENDING_CHECKOUT',
        statusChangedAt: expect.any(Date),
      },
    });
    expect(historyCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        fromStatus: 'WAITING_MOVE_IN',
        toStatus: 'PENDING_CHECKOUT',
      }),
    });
    expectContractMutationOrder(
      'checkout.initiate',
      tx.$queryRaw,
      tx.contract.findUniqueOrThrow,
      settlementCreate,
    );
    expectRoomBeforeTargetContractLock(tx.$queryRaw);
    expect(transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
    });
  });

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
      $queryRaw: jest.fn().mockResolvedValue([{ id: 1 }]),
      checkoutSettlement: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 1,
          status: 'DRAFT',
          contractId: 3,
          originContractStatus: 'PENDING_START',
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
      contract: {
        findUnique: jest.fn().mockResolvedValue({ id: 3, roomId: 7 }),
        updateMany: contractUpdateMany,
      },
      room: { updateMany: roomUpdateMany },
      checkoutRentRefundAllocation: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };
    mockRoomContractLocks(tx, 3, 7);
    const transaction = jest.fn(
      (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
    );
    const service = new CheckoutService({
      db: {
        $transaction: transaction,
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
      data: { status: 'PENDING_START' },
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
    expectContractMutationOrder(
      'checkout.cancel',
      tx.$queryRaw,
      tx.checkoutSettlement.findUniqueOrThrow,
      settlementUpdateMany,
    );
    expectRoomBeforeTargetContractLock(tx.$queryRaw);
    expect(transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
    });
  });

  it('rejects cancelling an approved settlement before restoring contract or room', async () => {
    const contractUpdateMany = jest.fn();
    const roomUpdateMany = jest.fn();
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 1 }]),
      checkoutSettlement: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 1,
          contractId: 3,
          status: 'APPROVED',
          contract: {
            status: 'PENDING_CHECKOUT',
            room: { roomStatus: 'PENDING_CHECKOUT' },
          },
        }),
      },
      contract: { updateMany: contractUpdateMany },
      room: { updateMany: roomUpdateMany },
      checkoutRentRefundAllocation: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };
    mockRoomContractLocks(tx, 3, 7);
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
  it('rejects duplicate rent-arrears items for the same bill', async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 1 }]),
      checkoutSettlement: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 1,
          status: 'DRAFT',
          contract: {
            status: 'PENDING_CHECKOUT',
            startDate: new Date('2026-01-01'),
            bills: [
              {
                id: 11,
                status: 'PENDING',
                outstandingAmount: new Prisma.Decimal('100.00'),
              },
            ],
          },
        }),
        update: jest.fn(),
      },
      checkoutSettlementItem: { deleteMany: jest.fn() },
    };
    const service = new CheckoutService({
      db: {
        $transaction: jest.fn(
          (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
        ),
      },
    } as never);

    await expect(
      service.submit(
        1,
        {
          actualCheckoutDate: '2026-08-01',
          handoverDate: '2026-08-01',
          inspectionAt: '2026-08-01T09:00:00.000Z',
          targetRoomStatus: 'EMPTY',
          items: [
            { itemType: 'RENT_ARREARS', rentBillId: 11, amount: '50.00' },
            { itemType: 'RENT_ARREARS', rentBillId: 11, amount: '50.00' },
          ],
        } as never,
        user,
      ),
    ).rejects.toThrow('同一欠租账单不能重复添加');
    expect(tx.checkoutSettlementItem.deleteMany).not.toHaveBeenCalled();
  });

  it('allows a pending-start checkout to use an actual date before the contract start date', async () => {
    const update = jest
      .fn()
      .mockResolvedValue({ id: 1, status: 'PENDING', items: [] });
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 1 }]),
      checkoutSettlement: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 1,
          status: 'DRAFT',
          originContractStatus: 'PENDING_START',
          items: [],
          contract: {
            status: 'PENDING_CHECKOUT',
            startDate: new Date('2026-09-01'),
            bills: [],
          },
        }),
        update,
      },
      checkoutSettlementItem: { deleteMany: jest.fn() },
      checkoutRentRefundAllocation: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
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
      service.submit(
        1,
        {
          actualCheckoutDate: '2026-08-20',
          handoverDate: '2026-08-20',
          inspectionAt: '2026-08-20T09:00:00.000Z',
          targetRoomStatus: 'EMPTY',
          items: [],
        } as never,
        user,
      ),
    ).resolves.toMatchObject({ id: 1, status: 'PENDING' });
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          actualCheckoutDate: new Date('2026-08-20'),
        }),
      }),
    );
    expectContractMutationOrder(
      'checkout.submit',
      tx.$queryRaw,
      tx.checkoutSettlement.findUniqueOrThrow,
      tx.checkoutSettlementItem.deleteMany,
    );
  });

  it('returns a rejected settlement to draft without deleting its items', async () => {
    const update = jest.fn().mockResolvedValue({ id: 1, status: 'DRAFT' });
    const harness = transactional({
      checkoutSettlement: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 1,
          status: 'REJECTED',
          items: [{ id: 1, amount: '500' }],
          contract: { status: 'PENDING_CHECKOUT' },
        }),
        update,
      },
    });
    const service = new CheckoutService({
      db: harness.db,
    } as never);

    await expect(service.returnToDraft(1, user)).resolves.toEqual({
      id: 1,
      status: 'DRAFT',
    });
    expect(update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { status: 'DRAFT' },
    });
    expectContractMutationOrder(
      'checkout.returnToDraft',
      harness.client.$queryRaw,
      harness.client.checkoutSettlement.findUniqueOrThrow,
      update,
    );
  });

  it('orders checkout reject as contract lock, settlement reload, then rejection write', async () => {
    const firstWrite = jest
      .fn()
      .mockResolvedValue({ id: 1, status: 'REJECTED' });
    const reload = jest.fn().mockResolvedValue({
      id: 1,
      status: 'PENDING',
      contract: { status: 'PENDING_CHECKOUT' },
    });
    const harness = transactional({
      checkoutSettlement: {
        findUniqueOrThrow: reload,
        update: firstWrite,
      },
    });
    const service = new CheckoutService({ db: harness.db } as never);

    await expect(service.reject(1, '信息有误', user)).resolves.toEqual({
      id: 1,
      status: 'REJECTED',
    });

    expectContractMutationOrder(
      'checkout.reject',
      harness.client.$queryRaw,
      reload,
      firstWrite,
    );
  });

  it('rejects returning a settlement that was not rejected', async () => {
    const service = new CheckoutService({
      db: transactional({
        checkoutSettlement: {
          findUniqueOrThrow: jest
            .fn()
            .mockResolvedValue({ id: 1, status: 'PENDING' }),
        },
      }).db,
    } as never);

    await expect(service.returnToDraft(1, user)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
  it('keeps contract and room pending checkout after settlement approval', async () => {
    const contractUpdate = jest.fn();
    const roomUpdate = jest.fn();
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      checkoutRentRefundAllocation: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      checkoutSettlement: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 1,
          contractId: 3,
          status: 'PENDING',
          actualCheckoutDate: new Date('2026-08-01'),
          rentRefundableAmount: new Prisma.Decimal('0.00'),
          items: [],
          contract: {
            status: 'PENDING_CHECKOUT',
            room: { id: 7 },
            bills: [],
          },
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
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
        checkoutSettlement: {
          findUniqueOrThrow: jest.fn().mockResolvedValue({ contractId: 3 }),
        },
        $transaction: jest.fn(
          (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
        ),
      },
    } as never);

    await service.approve(1, { ...user, role: 'SUPER_ADMIN' });

    expect(contractUpdate).not.toHaveBeenCalled();
    expect(roomUpdate).not.toHaveBeenCalled();
    expectContractMutationOrder(
      'checkout.approve',
      tx.$queryRaw,
      tx.checkoutSettlement.findUniqueOrThrow,
      tx.rentBill.updateMany,
      0,
    );
  });
  it('locks post-offset arrears separately and creates an inspection-only supplemental bill', async () => {
    const settlementUpdate = jest.fn().mockResolvedValue({ count: 1 });
    const supplementalCreate = jest.fn();
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      checkoutRentRefundAllocation: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      checkoutSettlement: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 1,
          contractId: 3,
          status: 'PENDING',
          actualCheckoutDate: new Date('2026-08-01'),
          rentRefundableAmount: new Prisma.Decimal('0.00'),
          items: [
            {
              itemType: 'RENT_ARREARS',
              amount: new Prisma.Decimal('100.00'),
              rentBillId: 11,
            },
            { itemType: 'REPAIR', amount: new Prisma.Decimal('100.00') },
          ],
          contract: {
            bills: [
              {
                id: 11,
                billNo: 'ZB2026080001',
                periodSeq: 1,
                periodStart: new Date('2026-08-01'),
                payableAmount: new Prisma.Decimal('100.00'),
                receivedAmount: new Prisma.Decimal('0.00'),
                outstandingAmount: new Prisma.Decimal('100.00'),
                status: 'PENDING',
              },
            ],
          },
        }),
        updateMany: settlementUpdate,
      },
      rentBill: {
        create: supplementalCreate,
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      depositTransaction: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ balanceAfter: new Prisma.Decimal('50.00') }),
        create: jest.fn(),
      },
      prepaymentTransaction: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const service = new CheckoutService({
      db: {
        checkoutSettlement: {
          findUniqueOrThrow: jest.fn().mockResolvedValue({ contractId: 3 }),
        },
        $transaction: jest.fn(
          (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
        ),
      },
    } as never);

    await service.approve(1, { ...user, role: 'SUPER_ADMIN' });

    expect(settlementUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          supplementalArrearsAmount: expect.objectContaining({}),
          supplementalInspectionAmount: expect.objectContaining({}),
          supplementalOutstandingAmount: expect.objectContaining({}),
        }),
      }),
    );
    const settlementData = settlementUpdate.mock.calls[0][0].data;
    expect(settlementData.supplementalArrearsAmount.toString()).toBe('50');
    expect(settlementData.supplementalInspectionAmount.toString()).toBe('100');
    expect(settlementData.supplementalOutstandingAmount.toString()).toBe('150');
    expect(supplementalCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          billCategory: 'CHECKOUT_SUPPLEMENTAL',
          payableAmount: expect.objectContaining({}),
        }),
      }),
    );
    expect(
      supplementalCreate.mock.calls[0][0].data.payableAmount.toString(),
    ).toBe('100');
  });
  it('completes an approved zero-refund settlement only after final confirmation', async () => {
    const settlementUpdate = jest.fn().mockResolvedValue({
      id: 1,
      status: 'COMPLETED',
    });
    const contractUpdate = jest.fn();
    const roomUpdate = jest.fn();
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 1 }]),
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
        findUnique: jest.fn().mockResolvedValue({ id: 3, roomId: 7 }),
        findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 3, roomId: 7 }),
        update: contractUpdate,
      },
      room: { update: roomUpdate },
      roomStatusHistory: { create: jest.fn() },
    };
    mockRoomContractLocks(tx, 3, 7);
    const transaction = jest.fn(
      (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
    );
    const service = new CheckoutService({
      db: {
        $transaction: transaction,
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
    expectContractMutationOrder(
      'checkout.completeZeroRefund',
      tx.$queryRaw,
      tx.checkoutSettlement.findUniqueOrThrow,
      tx.checkoutSettlement.updateMany,
    );
    expectRoomBeforeTargetContractLock(tx.$queryRaw);
    expect(transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
    });
  });

  it('allows final confirmation after a required supplemental receivable is fully collected', async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 1 }]),
      checkoutSettlement: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 1,
          contractId: 3,
          status: 'APPROVED',
          targetRoomStatus: 'EMPTY',
          depositRefundableAmount: '0.00',
          prepaymentRefundableAmount: '0.00',
          finalReceivable: '150.00',
          supplementalRequired: true,
          supplementalOutstandingAmount: '0.00',
          payment: { findFirst: jest.fn().mockResolvedValue(null) },
          contract: { id: 3, status: 'PENDING_CHECKOUT', roomId: 7 },
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockResolvedValue({ id: 1, status: 'COMPLETED' }),
      },
      payment: { findFirst: jest.fn().mockResolvedValue(null) },
      contract: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 3, roomId: 7 }),
        update: jest.fn(),
      },
      room: { update: jest.fn() },
      roomStatusHistory: { create: jest.fn() },
    };
    mockRoomContractLocks(tx, 3, 7);
    const service = new CheckoutService({
      db: {
        $transaction: jest.fn(
          (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
        ),
      },
    } as never);

    await expect(
      service.completeZeroRefund(1, { ...user, role: 'SUPER_ADMIN' }),
    ).resolves.toMatchObject({ status: 'COMPLETED' });
  });
  it('blocks final confirmation while a supplemental refund or void is pending', async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 1 }]),
      checkoutSettlement: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 1,
          contractId: 3,
          status: 'APPROVED',
          targetRoomStatus: 'EMPTY',
          depositRefundableAmount: '0.00',
          prepaymentRefundableAmount: '0.00',
          finalReceivable: '150.00',
          supplementalRequired: true,
          supplementalOutstandingAmount: '0.00',
          contract: { id: 3, status: 'PENDING_CHECKOUT', roomId: 7 },
        }),
        updateMany: jest.fn(),
      },
      payment: { findFirst: jest.fn().mockResolvedValue({ id: 81 }) },
    };
    mockRoomContractLocks(tx, 3, 7);
    const service = new CheckoutService({
      db: {
        $transaction: jest.fn(
          (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
        ),
      },
    } as never);

    await expect(
      service.completeZeroRefund(1, { ...user, role: 'SUPER_ADMIN' }),
    ).rejects.toThrow('退租补收款存在待审批退款或作废申请');
    expect(tx.checkoutSettlement.updateMany).not.toHaveBeenCalled();
  });

  it('rejects zero final confirmation when a locked amount is non-zero', async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 1 }]),
      checkoutSettlement: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 1,
          contractId: 3,
          status: 'APPROVED',
          depositRefundableAmount: '0.00',
          prepaymentRefundableAmount: '0.00',
          rentRefundableAmount: '500.00',
          finalReceivable: '0.00',
          contract: { status: 'PENDING_CHECKOUT' },
        }),
      },
    };
    mockRoomContractLocks(tx, 3, 7);
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
            rentRefundableAmount: new Prisma.Decimal('100.00'),
            finalReceivable: new Prisma.Decimal('0.00'),
            supplementalRequired: true,
            supplementalArrearsAmount: new Prisma.Decimal('50.00'),
            supplementalInspectionAmount: new Prisma.Decimal('100.00'),
            supplementalReceivedAmount: new Prisma.Decimal('75.00'),
            supplementalOutstandingAmount: new Prisma.Decimal('75.00'),
            supplementalCollectedAt: null,
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
      rentRefundableAmount: '100.00',
      supplementalRequired: true,
      supplementalArrearsAmount: '50.00',
      supplementalInspectionAmount: '100.00',
      supplementalReceivedAmount: '75.00',
      supplementalOutstandingAmount: '75.00',
      contract: { room: { roomNo: '301' } },
      items: [{ amount: '120.00' }],
      depositRefunds: [{ refundAmount: '1300.00' }],
    });
  });

  it('rejects a zero-refund confirmation when another confirmation already claimed the settlement', async () => {
    const contractUpdate = jest.fn();
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 1 }]),
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
    mockRoomContractLocks(tx, 3, 7);
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
                billCategory: 'RENT',
              },
              {
                periodStart: new Date('2026-09-01'),
                outstandingAmount: '300.00',
                status: 'UNPAID',
                billCategory: 'RENT',
              },
              {
                periodStart: new Date('2026-07-01'),
                outstandingAmount: '0.00',
                status: 'PAID',
              },
              {
                periodStart: new Date('2026-08-15'),
                outstandingAmount: '100.00',
                status: 'PENDING',
                billCategory: 'CHECKOUT_SUPPLEMENTAL',
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

  it('rejects every checkout mutation for a voided contract', async () => {
    const initiateCreate = jest.fn();
    const initiateTx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 1 }]),
      contract: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 3,
          status: 'VOIDED',
          roomId: 7,
          room: { id: 7, roomStatus: 'RENTED' },
        }),
        update: jest.fn(),
      },
      checkoutSettlement: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: initiateCreate,
      },
    };
    mockRoomContractLocks(initiateTx, 3, 7);
    const initiateService = new CheckoutService({
      db: {
        $transaction: jest.fn(
          (callback: (client: typeof initiateTx) => Promise<unknown>) =>
            callback(initiateTx),
        ),
      },
    } as never);
    const initiateDto = {
      checkoutType: '正常退租',
      plannedCheckoutDate: '2026-08-20',
      handoverDate: '2026-08-20',
      inspectionAt: '2026-08-20T09:00:00.000Z',
      checkoutReason: '不应允许',
      targetRoomStatus: 'EMPTY',
    } as never;

    await expect(
      initiateService.initiate(3, initiateDto, user),
    ).rejects.toThrow('已作废合同不能发起退租');
    expect(initiateCreate).not.toHaveBeenCalled();
    expect(initiateTx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      initiateTx.contract.findUniqueOrThrow.mock.invocationCallOrder[0],
    );

    const submitDelete = jest.fn();
    const submitTx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 1 }]),
      checkoutSettlement: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 1,
          status: 'DRAFT',
          originContractStatus: 'ACTIVE',
          contract: {
            status: 'VOIDED',
            startDate: new Date('2026-08-01'),
            bills: [],
          },
        }),
        update: jest.fn(),
      },
      checkoutSettlementItem: { deleteMany: submitDelete },
    };
    const submitService = new CheckoutService({
      db: {
        $transaction: jest.fn(
          (callback: (client: typeof submitTx) => Promise<unknown>) =>
            callback(submitTx),
        ),
      },
    } as never);
    await expect(
      submitService.submit(
        1,
        {
          actualCheckoutDate: '2026-08-20',
          handoverDate: '2026-08-20',
          inspectionAt: '2026-08-20T09:00:00.000Z',
          targetRoomStatus: 'EMPTY',
          items: [],
        } as never,
        user,
      ),
    ).rejects.toThrow('已作废合同不能提交退租结算');
    expect(submitDelete).not.toHaveBeenCalled();
    expect(submitTx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      submitTx.checkoutSettlement.findUniqueOrThrow.mock.invocationCallOrder[0],
    );

    const approveSettlement = {
      id: 1,
      contractId: 3,
      status: 'PENDING',
      actualCheckoutDate: new Date('2026-08-20'),
      items: [],
      contract: { status: 'VOIDED', bills: [] },
    };
    const approveTx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 1 }]),
      checkoutSettlement: {
        findUniqueOrThrow: jest.fn().mockResolvedValue(approveSettlement),
        update: jest.fn(),
      },
      rentBill: { update: jest.fn() },
    };
    const approveService = new CheckoutService({
      db: {
        checkoutSettlement: {
          findUniqueOrThrow: jest.fn().mockResolvedValue({ contractId: 3 }),
        },
        $transaction: jest.fn(
          (callback: (client: typeof approveTx) => Promise<unknown>) =>
            callback(approveTx),
        ),
      },
    } as never);
    await expect(approveService.approve(1, user)).rejects.toThrow(
      '已作废合同不能确认退租结算',
    );
    expect(approveTx.checkoutSettlement.update).not.toHaveBeenCalled();
    expect(approveTx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      approveTx.checkoutSettlement.findUniqueOrThrow.mock.invocationCallOrder.at(
        -1,
      )!,
    );

    const completeUpdate = jest.fn();
    const completeTx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 1 }]),
      checkoutSettlement: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 1,
          contractId: 3,
          status: 'APPROVED',
          depositRefundableAmount: '0.00',
          prepaymentRefundableAmount: '0.00',
          finalReceivable: '0.00',
          supplementalRequired: false,
          contract: { status: 'VOIDED' },
        }),
        updateMany: completeUpdate,
      },
    };
    mockRoomContractLocks(completeTx, 3, 7);
    const completeService = new CheckoutService({
      db: {
        $transaction: jest.fn(
          (callback: (client: typeof completeTx) => Promise<unknown>) =>
            callback(completeTx),
        ),
      },
    } as never);
    await expect(completeService.completeZeroRefund(1, user)).rejects.toThrow(
      '已作废合同不能完成退租结算',
    );
    expect(completeUpdate).not.toHaveBeenCalled();
    expectRoomBeforeTargetContractLock(completeTx.$queryRaw);

    const rejectUpdate = jest.fn();
    const rejectHarness = transactional({
      checkoutSettlement: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 1,
          status: 'PENDING',
          contract: { status: 'VOIDED' },
        }),
        update: rejectUpdate,
      },
    });
    const rejectService = new CheckoutService({
      db: rejectHarness.db,
    } as never);
    await expect(rejectService.reject(1, '信息有误', user)).rejects.toThrow(
      '已作废合同不能驳回退租结算',
    );
    expect(rejectUpdate).not.toHaveBeenCalled();
    expect(
      rejectHarness.client.$queryRaw.mock.invocationCallOrder[0],
    ).toBeLessThan(
      rejectHarness.client.checkoutSettlement.findUniqueOrThrow.mock
        .invocationCallOrder[0],
    );

    const cancelUpdate = jest.fn();
    const cancelTx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 1 }]),
      checkoutSettlement: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 1,
          contractId: 3,
          status: 'DRAFT',
          contract: {
            status: 'VOIDED',
            roomId: 7,
            room: { roomStatus: 'PENDING_CHECKOUT' },
          },
        }),
        updateMany: cancelUpdate,
      },
    };
    mockRoomContractLocks(cancelTx, 3, 7);
    const cancelService = new CheckoutService({
      db: {
        $transaction: jest.fn(
          (callback: (client: typeof cancelTx) => Promise<unknown>) =>
            callback(cancelTx),
        ),
      },
    } as never);
    await expect(cancelService.cancel(1, user)).rejects.toThrow(
      '已作废合同不能取消退租结算',
    );
    expect(cancelUpdate).not.toHaveBeenCalled();
    expectRoomBeforeTargetContractLock(cancelTx.$queryRaw);

    const draftUpdate = jest.fn();
    const draftHarness = transactional({
      checkoutSettlement: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 1,
          status: 'REJECTED',
          contract: { status: 'VOIDED' },
        }),
        update: draftUpdate,
      },
    });
    const draftService = new CheckoutService({
      db: draftHarness.db,
    } as never);
    await expect(draftService.returnToDraft(1, user)).rejects.toThrow(
      '已作废合同不能退回退租结算草稿',
    );
    expect(draftUpdate).not.toHaveBeenCalled();
    expect(
      draftHarness.client.$queryRaw.mock.invocationCallOrder[0],
    ).toBeLessThan(
      draftHarness.client.checkoutSettlement.findUniqueOrThrow.mock
        .invocationCallOrder[0],
    );
  });

  it('submits one rent-refund item without a bill or inspection reference', async () => {
    const update = jest.fn().mockResolvedValue({
      id: 1,
      status: 'PENDING',
      items: [
        {
          id: 81,
          checkoutSettlementId: 1,
          itemType: 'RENT_REFUND',
          amount: new Prisma.Decimal('100.00'),
          rentBillId: null,
          inspectionRecordRef: null,
          description: '提前退房退还未履行租金',
          evidenceRequired: false,
          confirmedByTenant: false,
          sortOrder: 0,
        },
      ],
    });
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 1 }]),
      checkoutSettlement: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 1,
          contractId: 3,
          status: 'DRAFT',
          items: [],
          originContractStatus: 'ACTIVE',
          contract: {
            id: 3,
            status: 'PENDING_CHECKOUT',
            startDate: new Date('2026-01-01'),
            bills: [],
          },
        }),
        update,
      },
      paymentAllocation: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 101,
            paymentId: 11,
            rentBillId: 21,
            allocatedAmount: new Prisma.Decimal('100.00'),
            reversedAmount: new Prisma.Decimal('0.00'),
            payment: {
              paymentDate: new Date('2026-08-05'),
              voidRequests: [],
            },
            rentBill: {
              billNo: 'ZJ2026080001',
              periodStart: new Date('2026-08-01'),
              periodEnd: new Date('2026-08-31'),
            },
            refundAllocations: [],
            checkoutRentRefundAllocations: [],
          },
        ]),
      },
      checkoutRentRefundAllocation: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      checkoutSettlementItem: { deleteMany: jest.fn() },
    };
    const service = new CheckoutService({
      db: {
        $transaction: jest.fn(
          (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
        ),
      },
    } as never);

    await expect(
      service.submit(
        1,
        {
          actualCheckoutDate: '2026-08-20',
          handoverDate: '2026-08-20',
          inspectionAt: '2026-08-20T09:00:00.000Z',
          targetRoomStatus: 'EMPTY',
          items: [
            {
              itemType: 'RENT_REFUND',
              amount: '100.00',
              description: '提前退房退还未履行租金',
            },
          ],
        } as never,
        user,
      ),
    ).resolves.toMatchObject({ id: 1, status: 'PENDING' });
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          items: {
            create: [
              expect.objectContaining({
                itemType: 'RENT_REFUND',
                amount: expect.any(Prisma.Decimal),
              }),
            ],
          },
        }),
      }),
    );
  });

  it('rejects duplicate rent-refund items before writing a submitted settlement', async () => {
    const deleteMany = jest.fn();
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 1 }]),
      checkoutSettlement: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 1,
          contractId: 3,
          status: 'DRAFT',
          originContractStatus: 'ACTIVE',
          contract: {
            id: 3,
            status: 'PENDING_CHECKOUT',
            startDate: new Date('2026-01-01'),
            bills: [],
          },
        }),
        update: jest.fn(),
      },
      checkoutSettlementItem: { deleteMany },
    };
    const service = new CheckoutService({
      db: {
        $transaction: jest.fn(
          (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
        ),
      },
    } as never);

    await expect(
      service.submit(
        1,
        {
          actualCheckoutDate: '2026-08-20',
          handoverDate: '2026-08-20',
          inspectionAt: '2026-08-20T09:00:00.000Z',
          targetRoomStatus: 'EMPTY',
          items: [
            {
              itemType: 'RENT_REFUND',
              amount: '100.00',
              description: '第一项',
            },
            {
              itemType: 'RENT_REFUND',
              amount: '50.00',
              description: '第二项',
            },
          ],
        } as never,
        user,
      ),
    ).rejects.toThrow('同一退租结算只能添加一项退还租金');
    expect(deleteMany).not.toHaveBeenCalled();
  });

  it('previews rent refund allocations from the unoccupied balance without writing', async () => {
    const checkoutRentRefundCreate = jest.fn();
    const paymentAllocationUpdate = jest.fn();
    const db = {
      checkoutSettlement: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 8,
          contractId: 3,
          status: 'DRAFT',
          originContractStatus: 'ACTIVE',
          contract: {
            id: 3,
            status: 'PENDING_CHECKOUT',
            startDate: new Date('2026-01-01'),
            bills: [],
          },
        }),
      },
      depositTransaction: {
        findFirst: jest.fn().mockResolvedValue({ balanceAfter: '100.00' }),
      },
      prepaymentTransaction: {
        findFirst: jest.fn().mockResolvedValue({ balanceAfter: '50.00' }),
      },
      paymentAllocation: {
        findMany: jest.fn().mockResolvedValue([
          {
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
            refundAllocations: [
              { reversedAmount: new Prisma.Decimal('200.00') },
            ],
            checkoutRentRefundAllocations: [
              {
                reservedAmount: new Prisma.Decimal('300.00'),
                item: { checkoutSettlementId: 8 },
              },
              {
                reservedAmount: new Prisma.Decimal('30.00'),
                item: { checkoutSettlementId: 9 },
              },
            ],
          },
          {
            id: 102,
            paymentId: 12,
            rentBillId: 22,
            allocatedAmount: new Prisma.Decimal('500.00'),
            reversedAmount: new Prisma.Decimal('50.00'),
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
            ],
            checkoutRentRefundAllocations: [
              {
                reservedAmount: new Prisma.Decimal('75.00'),
                item: { checkoutSettlementId: 8 },
              },
              {
                reservedAmount: new Prisma.Decimal('25.00'),
                item: { checkoutSettlementId: 10 },
              },
            ],
          },
        ]),
        update: paymentAllocationUpdate,
      },
      checkoutRentRefundAllocation: { create: checkoutRentRefundCreate },
    };
    const service = new CheckoutService({ db } as never);

    await expect(
      service.preview(8, {
        actualCheckoutDate: '2026-08-15',
        handoverDate: '2026-08-15',
        inspectionAt: '2026-08-15T09:00:00.000Z',
        targetRoomStatus: 'EMPTY',
        items: [
          {
            itemType: 'RENT_REFUND',
            amount: '600.00',
            description: '提前退房退还未履行租金',
          },
        ],
      } as never),
    ).resolves.toMatchObject({
      depositRefundableAmount: '100.00',
      prepaymentRefundableAmount: '50.00',
      rentRefundableAmount: '600.00',
      maxRentRefundAmount: '1070.00',
      totalRefundAmount: '750.00',
      rentRefundAllocations: [
        {
          paymentAllocationId: 102,
          paymentId: 12,
          rentBillId: 22,
          billNo: 'ZJ2026090001',
          amount: '400.00',
        },
        {
          paymentAllocationId: 101,
          paymentId: 11,
          rentBillId: 21,
          billNo: 'ZJ2026080001',
          amount: '200.00',
        },
      ],
    });
    expect(db.paymentAllocation.findMany).toHaveBeenCalledWith({
      where: {
        payment: {
          contractId: 3,
          paymentCategory: 'RENT',
          status: { in: ['CONFIRMED', 'PARTIALLY_REFUNDED'] },
        },
        rentBill: { billCategory: 'RENT' },
      },
      select: {
        id: true,
        paymentId: true,
        rentBillId: true,
        allocatedAmount: true,
        reversedAmount: true,
        payment: {
          select: {
            paymentDate: true,
            voidRequests: {
              where: { approvalStatus: 'PENDING' },
              select: { id: true },
            },
          },
        },
        rentBill: {
          select: { billNo: true, periodStart: true, periodEnd: true },
        },
        refundAllocations: {
          where: { paymentRefund: { approvalStatus: 'PENDING' } },
          select: { reversedAmount: true },
        },
        checkoutRentRefundAllocations: {
          where: { status: 'RESERVED' },
          select: {
            reservedAmount: true,
            item: { select: { checkoutSettlementId: true } },
          },
        },
      },
    });
    expect(checkoutRentRefundCreate).not.toHaveBeenCalled();
    expect(paymentAllocationUpdate).not.toHaveBeenCalled();
  });

  it('translates a nonzero rent-refund excess to the specified Chinese error', async () => {
    const db = {
      checkoutSettlement: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 8,
          contractId: 3,
          status: 'DRAFT',
          originContractStatus: 'ACTIVE',
          contract: {
            id: 3,
            status: 'PENDING_CHECKOUT',
            startDate: new Date('2026-01-01'),
            bills: [],
          },
        }),
      },
      depositTransaction: { findFirst: jest.fn().mockResolvedValue(null) },
      prepaymentTransaction: { findFirst: jest.fn().mockResolvedValue(null) },
      paymentAllocation: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 101,
            paymentId: 11,
            rentBillId: 21,
            allocatedAmount: new Prisma.Decimal('100.00'),
            reversedAmount: new Prisma.Decimal('0.00'),
            payment: {
              paymentDate: new Date('2026-08-05'),
              voidRequests: [],
            },
            rentBill: {
              periodStart: new Date('2026-08-01'),
              periodEnd: new Date('2026-08-31'),
            },
            refundAllocations: [],
            checkoutRentRefundAllocations: [],
          },
        ]),
      },
    };
    const service = new CheckoutService({ db } as never);

    await expect(
      service.preview(8, {
        actualCheckoutDate: '2026-08-15',
        handoverDate: '2026-08-15',
        inspectionAt: '2026-08-15T09:00:00.000Z',
        targetRoomStatus: 'EMPTY',
        items: [
          {
            itemType: 'RENT_REFUND',
            amount: '100.01',
            description: '提前退房退还未履行租金',
          },
        ],
      } as never),
    ).rejects.toThrow('退还租金不能超过当前可回冲金额 ¥100.00。');
  });

  it('translates an unavailable rent refund preview to the specified Chinese error', async () => {
    const db = {
      checkoutSettlement: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 8,
          contractId: 3,
          status: 'DRAFT',
          originContractStatus: 'ACTIVE',
          contract: {
            id: 3,
            status: 'PENDING_CHECKOUT',
            startDate: new Date('2026-01-01'),
            bills: [],
          },
        }),
      },
      depositTransaction: { findFirst: jest.fn().mockResolvedValue(null) },
      prepaymentTransaction: { findFirst: jest.fn().mockResolvedValue(null) },
      paymentAllocation: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const service = new CheckoutService({ db } as never);

    await expect(
      service.preview(8, {
        actualCheckoutDate: '2026-08-15',
        handoverDate: '2026-08-15',
        inspectionAt: '2026-08-15T09:00:00.000Z',
        targetRoomStatus: 'EMPTY',
        items: [
          {
            itemType: 'RENT_REFUND',
            amount: '0.01',
            description: '提前退房退还未履行租金',
          },
        ],
      } as never),
    ).rejects.toThrow('当前合同没有可回冲的已缴租金。');
  });

  const rentRefundSubmitHarness = () => {
    const deleteMany = jest.fn();
    const update = jest.fn().mockResolvedValue({ id: 1, status: 'PENDING' });
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 1 }]),
      checkoutSettlement: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 1,
          contractId: 3,
          status: 'DRAFT',
          originContractStatus: 'ACTIVE',
          contract: {
            id: 3,
            status: 'PENDING_CHECKOUT',
            startDate: new Date('2026-01-01'),
            bills: [],
          },
        }),
        update,
      },
      checkoutSettlementItem: { deleteMany },
    };
    return {
      deleteMany,
      update,
      service: new CheckoutService({
        db: {
          $transaction: jest.fn(
            (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
          ),
        },
      } as never),
    };
  };

  it('rejects a rent refund carrying an inspection reference before submit writes', async () => {
    const { service, deleteMany, update } = rentRefundSubmitHarness();

    await expect(
      service.submit(
        1,
        {
          actualCheckoutDate: '2026-08-20',
          handoverDate: '2026-08-20',
          inspectionAt: '2026-08-20T09:00:00.000Z',
          targetRoomStatus: 'EMPTY',
          items: [
            {
              itemType: 'RENT_REFUND',
              amount: '100.00',
              inspectionRecordRef: 'YF-OTHER-CONTRACT',
              description: '提前退房退还未履行租金',
            },
          ],
        } as never,
        user,
      ),
    ).rejects.toThrow('退还租金不能关联租金账单或验房记录');
    expect(deleteMany).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('rejects a rent refund carrying another contract bill id during preview', async () => {
    const paymentAllocationFindMany = jest.fn().mockResolvedValue([
      {
        id: 101,
        paymentId: 11,
        rentBillId: 21,
        allocatedAmount: new Prisma.Decimal('100.00'),
        reversedAmount: new Prisma.Decimal('0.00'),
        payment: {
          paymentDate: new Date('2026-08-05'),
          voidRequests: [],
        },
        rentBill: {
          billNo: 'ZJ2026080001',
          periodStart: new Date('2026-08-01'),
          periodEnd: new Date('2026-08-31'),
        },
        refundAllocations: [],
        checkoutRentRefundAllocations: [],
      },
    ]);
    const service = new CheckoutService({
      db: {
        checkoutSettlement: {
          findUniqueOrThrow: jest.fn().mockResolvedValue({
            id: 8,
            contractId: 3,
            status: 'DRAFT',
            originContractStatus: 'ACTIVE',
            contract: {
              id: 3,
              status: 'PENDING_CHECKOUT',
              startDate: new Date('2026-01-01'),
              bills: [],
            },
          }),
        },
        depositTransaction: { findFirst: jest.fn().mockResolvedValue(null) },
        prepaymentTransaction: { findFirst: jest.fn().mockResolvedValue(null) },
        paymentAllocation: { findMany: paymentAllocationFindMany },
      },
    } as never);

    await expect(
      service.preview(8, {
        actualCheckoutDate: '2026-08-15',
        handoverDate: '2026-08-15',
        inspectionAt: '2026-08-15T09:00:00.000Z',
        targetRoomStatus: 'EMPTY',
        items: [
          {
            itemType: 'RENT_REFUND',
            amount: '10.00',
            rentBillId: 999,
            description: '提前退房退还未履行租金',
          },
        ],
      } as never),
    ).rejects.toThrow('退还租金不能关联租金账单或验房记录');
    expect(paymentAllocationFindMany).not.toHaveBeenCalled();
  });

  it('rejects a sub-cent rent refund before submit writes with a Chinese error', async () => {
    const { service, deleteMany, update } = rentRefundSubmitHarness();

    await expect(
      service.submit(
        1,
        {
          actualCheckoutDate: '2026-08-20',
          handoverDate: '2026-08-20',
          inspectionAt: '2026-08-20T09:00:00.000Z',
          targetRoomStatus: 'EMPTY',
          items: [
            {
              itemType: 'RENT_REFUND',
              amount: '0.001',
              description: '提前退房退还未履行租金',
            },
          ],
        } as never,
        user,
      ),
    ).rejects.toThrow(
      '结算项目金额必须是大于零、最多12位整数和2位小数的普通十进制字符串',
    );
    expect(deleteMany).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });
  it('submits and reserves the backend-recalculated rent refund inside one transaction', async () => {
    const reserveCreateMany = jest.fn().mockResolvedValue({ count: 1 });
    const settlementUpdate = jest.fn().mockResolvedValue({
      id: 9,
      status: 'PENDING',
      items: [
        {
          id: 81,
          checkoutSettlementId: 9,
          itemType: 'RENT_REFUND',
          amount: new Prisma.Decimal('600.00'),
          rentBillId: null,
          inspectionRecordRef: null,
          description: '提前退房退还未履行租金',
          evidenceRequired: false,
          confirmedByTenant: false,
          sortOrder: 0,
        },
      ],
    });
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      checkoutSettlement: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 9,
          contractId: 4,
          status: 'DRAFT',
          originContractStatus: 'ACTIVE',
          items: [],
          contract: {
            id: 4,
            status: 'PENDING_CHECKOUT',
            startDate: new Date('2026-01-01'),
            bills: [],
          },
        }),
        update: settlementUpdate,
      },
      checkoutSettlementItem: { deleteMany: jest.fn() },
      paymentAllocation: {
        findMany: jest.fn().mockResolvedValue([
          {
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
            refundAllocations: [
              { reversedAmount: new Prisma.Decimal('200.00') },
            ],
            checkoutRentRefundAllocations: [
              {
                reservedAmount: new Prisma.Decimal('100.00'),
                item: { checkoutSettlementId: 10 },
              },
            ],
          },
        ]),
      },
      checkoutRentRefundAllocation: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        createMany: reserveCreateMany,
      },
    };
    const service = new CheckoutService({
      db: {
        $transaction: jest.fn(
          (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
        ),
      },
    } as never);

    await service.submit(
      9,
      {
        actualCheckoutDate: '2026-08-15',
        handoverDate: '2026-08-15',
        inspectionAt: '2026-08-15T09:00:00.000Z',
        targetRoomStatus: 'EMPTY',
        items: [
          {
            itemType: 'RENT_REFUND',
            amount: '600.00',
            description: '提前退房退还未履行租金',
          },
        ],
      } as never,
      user,
    );

    expect(settlementUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          rentRefundableAmount: new Prisma.Decimal('600.00'),
        }),
      }),
    );
    expect(reserveCreateMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          checkoutSettlementItemId: 81,
          reservedAmount: new Prisma.Decimal('600.00'),
          status: 'RESERVED',
        }),
      ],
    });
    const locks = tx.$queryRaw.mock.calls.map(([sql]) => ({
      statement:
        (sql as { strings?: readonly string[] }).strings?.join('?') ?? '',
      values: (sql as { values?: readonly unknown[] }).values,
    }));
    expect(
      locks.slice(0, 4).map(({ statement, values }) => ({
        table: /SELECT id FROM ([a-z_]+)/.exec(statement)?.[1],
        forUpdate: statement.includes('FOR UPDATE'),
        stable:
          !statement.includes('rent_bills') ||
          statement.includes('ORDER BY id FOR UPDATE'),
        values,
      })),
    ).toEqual([
      { table: 'contracts', forUpdate: true, stable: true, values: [9] },
      {
        table: 'checkout_settlements',
        forUpdate: true,
        stable: true,
        values: [9],
      },
      { table: 'rent_bills', forUpdate: true, stable: true, values: [9] },
      {
        table: 'checkout_settlement_items',
        forUpdate: true,
        stable: true,
        values: [9],
      },
    ]);
    expect(tx.$queryRaw.mock.invocationCallOrder[3]).toBeLessThan(
      tx.checkoutSettlement.findUniqueOrThrow.mock.invocationCallOrder[0],
    );
    expect(
      tx.checkoutSettlement.findUniqueOrThrow.mock.invocationCallOrder[0],
    ).toBeLessThan(
      tx.checkoutSettlementItem.deleteMany.mock.invocationCallOrder[0],
    );
    expect(
      tx.checkoutSettlementItem.deleteMany.mock.invocationCallOrder[0],
    ).toBeLessThan(settlementUpdate.mock.invocationCallOrder[0]);
    expect(settlementUpdate.mock.invocationCallOrder[0]).toBeLessThan(
      tx.$queryRaw.mock.invocationCallOrder[4],
    );
    expect(tx.$queryRaw.mock.invocationCallOrder[10]).toBeLessThan(
      tx.checkoutRentRefundAllocation.updateMany.mock.invocationCallOrder[0],
    );
    expect(
      tx.checkoutRentRefundAllocation.updateMany.mock.invocationCallOrder[0],
    ).toBeLessThan(tx.paymentAllocation.findMany.mock.invocationCallOrder[0]);
    expect(
      tx.paymentAllocation.findMany.mock.invocationCallOrder[0],
    ).toBeLessThan(reserveCreateMany.mock.invocationCallOrder[0]);
  });

  it.each([
    ['reject', 'PENDING'],
    ['returnToDraft', 'REJECTED'],
  ] as const)(
    'releases active rent refund reservations on %s',
    async (action, status) => {
      const release = jest.fn().mockResolvedValue({ count: 1 });
      const update = jest.fn().mockResolvedValue({ id: 9 });
      const tx = {
        $queryRaw: jest.fn().mockResolvedValue([]),
        checkoutSettlement: {
          findUniqueOrThrow: jest.fn().mockResolvedValue({
            id: 9,
            status,
            contract: { status: 'PENDING_CHECKOUT' },
          }),
          update,
        },
        checkoutRentRefundAllocation: { updateMany: release },
      };
      const service = new CheckoutService({
        db: {
          $transaction: jest.fn(
            (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
          ),
        },
      } as never);

      if (action === 'reject') await service.reject(9, '信息有误', user);
      else await service.returnToDraft(9, user);

      expect(release).toHaveBeenCalledWith({
        where: {
          status: 'RESERVED',
          item: { checkoutSettlementId: 9 },
        },
        data: { status: 'RELEASED', releasedAt: expect.any(Date) },
      });
      expect(release.mock.invocationCallOrder[0]).toBeLessThan(
        update.mock.invocationCallOrder[0],
      );
    },
  );

  it('releases active rent refund reservations when checkout is cancelled', async () => {
    const release = jest.fn().mockResolvedValue({ count: 1 });
    const settlementUpdate = jest.fn().mockResolvedValue({ count: 1 });
    const findUniqueOrThrow = jest
      .fn()
      .mockResolvedValueOnce({ contractId: 4 })
      .mockResolvedValueOnce({
        id: 9,
        contractId: 4,
        status: 'DRAFT',
        originContractStatus: 'ACTIVE',
        supplementalRequired: false,
        contract: {
          status: 'PENDING_CHECKOUT',
          roomId: 7,
          room: { roomStatus: 'PENDING_CHECKOUT' },
        },
      });
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      checkoutSettlement: {
        findUniqueOrThrow,
        updateMany: settlementUpdate,
        findUnique: jest.fn().mockResolvedValue({ id: 9, status: 'CANCELLED' }),
      },
      checkoutRentRefundAllocation: { updateMany: release },
      contract: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      room: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      roomStatusHistory: {
        findFirst: jest.fn().mockResolvedValue({ fromStatus: 'OCCUPIED' }),
        create: jest.fn().mockResolvedValue({}),
      },
    };
    mockRoomContractLocks(tx, 4, 7);
    const service = new CheckoutService({
      db: {
        $transaction: jest.fn(
          (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
        ),
      },
    } as never);

    await service.cancel(9, user);

    expect(release).toHaveBeenCalledWith({
      where: {
        status: 'RESERVED',
        item: { checkoutSettlementId: 9 },
      },
      data: { status: 'RELEASED', releasedAt: expect.any(Date) },
    });
    expect(release.mock.invocationCallOrder[0]).toBeLessThan(
      settlementUpdate.mock.invocationCallOrder[0],
    );
  });

  it('rejects approval before financial writes when reserved detail was tampered with', async () => {
    const checkoutUpdate = jest.fn();
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      checkoutSettlement: {
        findUniqueOrThrow: jest.fn().mockResolvedValueOnce({
          id: 9,
          contractId: 4,
          status: 'PENDING',
          actualCheckoutDate: new Date('2026-08-15'),
          rentRefundableAmount: new Prisma.Decimal('600.00'),
          items: [
            {
              id: 81,
              itemType: 'RENT_REFUND',
              amount: new Prisma.Decimal('600.00'),
            },
          ],
          contract: {
            status: 'PENDING_CHECKOUT',
            room: { id: 7 },
            bills: [],
          },
        }),
        update: checkoutUpdate,
      },
      checkoutRentRefundAllocation: {
        findMany: jest.fn().mockResolvedValue([
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
        ]),
      },
    };
    const service = new CheckoutService({
      db: {
        checkoutSettlement: {
          findUniqueOrThrow: jest.fn().mockResolvedValue({ contractId: 4 }),
        },
        $transaction: jest.fn(
          (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
        ),
      },
    } as never);

    await expect(
      service.approve(9, { ...user, role: 'SUPER_ADMIN' }),
    ).rejects.toThrow('退租退款预留明细已变化，请退回草稿后重新提交。');
    expect(checkoutUpdate).not.toHaveBeenCalled();
  });

  it('re-reads settlement state after the contract lock and rejects a stale pending approval without writes', async () => {
    const identityLookup = jest.fn().mockResolvedValue({
      contractId: 4,
      status: 'PENDING',
    });
    const pendingSnapshot = {
      id: 9,
      contractId: 4,
      settlementNo: 'TZ202608300009',
      status: 'PENDING',
      actualCheckoutDate: new Date('2026-08-15'),
      rentRefundableAmount: new Prisma.Decimal('0.00'),
      items: [],
      contract: {
        status: 'PENDING_CHECKOUT',
        room: { id: 7 },
        bills: [],
      },
    };
    const transactionRead = jest.fn().mockImplementation(() => {
      if (identityLookup.mock.calls.length)
        return Promise.resolve({ ...pendingSnapshot, status: 'REJECTED' });
      if (transactionRead.mock.calls.length === 1)
        return Promise.resolve({ contractId: 4 });
      return Promise.resolve(pendingSnapshot);
    });
    const legacyStatusWrite = jest.fn().mockResolvedValue({
      ...pendingSnapshot,
      status: 'APPROVED',
    });
    const statusCas = jest.fn().mockResolvedValue({ count: 1 });
    const rentBillUpdate = jest.fn();
    const rentBillUpdateMany = jest.fn();
    const depositLedgerWrite = jest.fn();
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      checkoutSettlement: {
        findUniqueOrThrow: transactionRead,
        update: legacyStatusWrite,
        updateMany: statusCas,
      },
      checkoutRentRefundAllocation: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      rentBill: {
        update: rentBillUpdate,
        updateMany: rentBillUpdateMany,
        create: jest.fn(),
      },
      depositTransaction: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: depositLedgerWrite,
      },
      prepaymentTransaction: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
    };
    const service = new CheckoutService({
      db: {
        checkoutSettlement: { findUniqueOrThrow: identityLookup },
        $transaction: jest.fn(
          (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
        ),
      },
    } as never);

    await expect(
      service.approve(9, { ...user, role: 'SUPER_ADMIN' }),
    ).rejects.toThrow('只有待确认结算单可以确认');

    expect(identityLookup).toHaveBeenCalledWith({
      where: { id: 9 },
      select: { contractId: true },
    });
    const contractLock = tx.$queryRaw.mock.calls.find(([sql]) =>
      (
        (sql as { strings?: readonly string[] }).strings?.join('?') ?? ''
      ).includes('FROM contracts'),
    )?.[0] as { values?: readonly unknown[] } | undefined;
    expect(contractLock?.values).toEqual([4]);
    expect(
      tx.$queryRaw.mock.invocationCallOrder.find((order, index) => {
        const sql = tx.$queryRaw.mock.calls[index][0] as {
          strings?: readonly string[];
        };
        return sql.strings?.join('?').includes('FROM contracts');
      }),
    ).toBeLessThan(transactionRead.mock.invocationCallOrder[0]);
    expect(rentBillUpdate).not.toHaveBeenCalled();
    expect(rentBillUpdateMany).not.toHaveBeenCalled();
    expect(depositLedgerWrite).not.toHaveBeenCalled();
    expect(legacyStatusWrite).not.toHaveBeenCalled();
    expect(statusCas).not.toHaveBeenCalled();
  });

  it('approves a positive locked rent refund with a pending-status CAS and keeps every reservation reserved', async () => {
    const identityLookup = jest.fn().mockResolvedValue({ contractId: 4 });
    const settlement = {
      id: 9,
      contractId: 4,
      settlementNo: 'TZ202608300009',
      status: 'PENDING',
      actualCheckoutDate: new Date('2026-08-15'),
      rentRefundableAmount: new Prisma.Decimal('600.00'),
      items: [
        {
          id: 81,
          itemType: 'RENT_REFUND',
          amount: new Prisma.Decimal('600.00'),
        },
      ],
      contract: {
        status: 'PENDING_CHECKOUT',
        room: { id: 7 },
        bills: [],
      },
    };
    const reservations = [
      {
        id: 501,
        paymentAllocationId: 101,
        paymentId: 11,
        rentBillId: 21,
        reservedAmount: new Prisma.Decimal('250.00'),
        item: {
          checkoutSettlementId: 9,
          itemType: 'RENT_REFUND',
          amount: new Prisma.Decimal('600.00'),
        },
        paymentAllocation: { paymentId: 11, rentBillId: 21 },
      },
      {
        id: 502,
        paymentAllocationId: 102,
        paymentId: 12,
        rentBillId: 22,
        reservedAmount: new Prisma.Decimal('350.00'),
        item: {
          checkoutSettlementId: 9,
          itemType: 'RENT_REFUND',
          amount: new Prisma.Decimal('600.00'),
        },
        paymentAllocation: { paymentId: 12, rentBillId: 22 },
      },
    ];
    const reservationStatusWrite = jest.fn();
    const statusCas = jest.fn().mockResolvedValue({ count: 1 });
    const legacyStatusWrite = jest.fn().mockResolvedValue({
      ...settlement,
      status: 'APPROVED',
    });
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      checkoutSettlement: {
        findUniqueOrThrow: jest.fn().mockResolvedValue(settlement),
        update: legacyStatusWrite,
        updateMany: statusCas,
      },
      checkoutRentRefundAllocation: {
        findMany: jest.fn().mockResolvedValue(reservations),
        updateMany: reservationStatusWrite,
      },
      rentBill: {
        update: jest.fn(),
        updateMany: jest.fn(),
        create: jest.fn(),
      },
      depositTransaction: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn(),
      },
      prepaymentTransaction: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
    };
    const service = new CheckoutService({
      db: {
        checkoutSettlement: { findUniqueOrThrow: identityLookup },
        $transaction: jest.fn(
          (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
        ),
      },
    } as never);

    await expect(
      service.approve(9, { ...user, role: 'SUPER_ADMIN' }),
    ).resolves.toBeDefined();

    expect(statusCas).toHaveBeenCalledWith({
      where: { id: 9, status: 'PENDING' },
      data: expect.objectContaining({
        status: 'APPROVED',
        rentRefundableAmount: new Prisma.Decimal('600.00'),
      }),
    });
    expect(legacyStatusWrite).not.toHaveBeenCalled();
    expect(reservationStatusWrite).not.toHaveBeenCalled();
    expect(reservations.map((item) => item.reservedAmount.toFixed(2))).toEqual([
      '250.00',
      '350.00',
    ]);
  });

  it('rejects approval with a Chinese conflict when the pending-status CAS claims no settlement', async () => {
    const settlement = {
      id: 9,
      contractId: 4,
      settlementNo: 'TZ202608300009',
      status: 'PENDING',
      actualCheckoutDate: new Date('2026-08-15'),
      rentRefundableAmount: new Prisma.Decimal('0.00'),
      items: [],
      contract: {
        status: 'PENDING_CHECKOUT',
        room: { id: 7 },
        bills: [],
      },
    };
    const statusCas = jest.fn().mockResolvedValue({ count: 0 });
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      checkoutSettlement: {
        findUniqueOrThrow: jest.fn().mockResolvedValue(settlement),
        updateMany: statusCas,
      },
      checkoutRentRefundAllocation: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      rentBill: {
        update: jest.fn(),
        updateMany: jest.fn(),
        create: jest.fn(),
      },
      depositTransaction: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn(),
      },
      prepaymentTransaction: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
    };
    const service = new CheckoutService({
      db: {
        checkoutSettlement: {
          findUniqueOrThrow: jest.fn().mockResolvedValue({ contractId: 4 }),
        },
        $transaction: jest.fn(
          (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
        ),
      },
    } as never);

    await expect(
      service.approve(9, { ...user, role: 'SUPER_ADMIN' }),
    ).rejects.toThrow('退租结算单状态已变化，请刷新后重试');
    expect(statusCas).toHaveBeenCalledWith({
      where: { id: 9, status: 'PENDING' },
      data: expect.objectContaining({ status: 'APPROVED' }),
    });
  });

  it('removes a rent refund from the current API without zeroing its historical item and releases reservations', async () => {
    const historicalItem = {
      id: 81,
      checkoutSettlementId: 9,
      itemType: 'RENT_REFUND',
      amount: new Prisma.Decimal('100.00'),
      rentBillId: null,
      inspectionRecordRef: null,
      description: '历史退还租金',
      evidenceRequired: false,
      confirmedByTenant: false,
      sortOrder: 0,
    };
    const itemUpdate = jest.fn();
    const settlementUpdate = jest.fn().mockResolvedValue({
      id: 9,
      status: 'PENDING',
      rentRefundableAmount: new Prisma.Decimal('0.00'),
      items: [historicalItem],
    });
    const release = jest.fn().mockResolvedValue({ count: 1 });
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      checkoutSettlement: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 9,
          contractId: 4,
          status: 'DRAFT',
          originContractStatus: 'ACTIVE',
          items: [historicalItem],
          contract: {
            id: 4,
            status: 'PENDING_CHECKOUT',
            startDate: new Date('2026-01-01'),
            bills: [],
          },
        }),
        update: settlementUpdate,
      },
      checkoutSettlementItem: {
        deleteMany: jest.fn(),
        update: itemUpdate,
      },
      checkoutRentRefundAllocation: { updateMany: release },
    };
    const service = new CheckoutService({
      db: {
        $transaction: jest.fn(
          (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
        ),
      },
    } as never);

    const result = await service.submit(
      9,
      {
        actualCheckoutDate: '2026-08-15',
        handoverDate: '2026-08-15',
        inspectionAt: '2026-08-15T09:00:00.000Z',
        targetRoomStatus: 'EMPTY',
        items: [],
      } as never,
      user,
    );

    expect(result.items).toEqual([]);
    expect(itemUpdate).not.toHaveBeenCalled();
    expect(historicalItem).toMatchObject({
      id: 81,
      amount: new Prisma.Decimal('100.00'),
    });
    expect(settlementUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          rentRefundableAmount: new Prisma.Decimal('0.00'),
          items: { create: [] },
        }),
      }),
    );
    expect(release).toHaveBeenCalledWith({
      where: {
        status: 'RESERVED',
        item: { checkoutSettlementId: 9 },
      },
      data: { status: 'RELEASED', releasedAt: expect.any(Date) },
    });
  });

  it('reuses the single historical rent-refund item when a changed amount is submitted again', async () => {
    const historicalItem = {
      id: 81,
      checkoutSettlementId: 9,
      itemType: 'RENT_REFUND',
      amount: new Prisma.Decimal('100.00'),
      rentBillId: null,
      inspectionRecordRef: null,
      description: '历史退还租金',
      evidenceRequired: false,
      confirmedByTenant: false,
      sortOrder: 0,
    };
    const changedItem = {
      ...historicalItem,
      amount: new Prisma.Decimal('200.00'),
      description: '再次申请退还租金',
    };
    const itemUpdate = jest.fn().mockResolvedValue(changedItem);
    const settlementUpdate = jest.fn().mockResolvedValue({
      id: 9,
      status: 'PENDING',
      rentRefundableAmount: new Prisma.Decimal('200.00'),
      items: [changedItem],
    });
    const reserveCreateMany = jest.fn().mockResolvedValue({ count: 1 });
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      checkoutSettlement: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 9,
          contractId: 4,
          status: 'DRAFT',
          originContractStatus: 'ACTIVE',
          items: [historicalItem],
          contract: {
            id: 4,
            status: 'PENDING_CHECKOUT',
            startDate: new Date('2026-01-01'),
            bills: [],
          },
        }),
        update: settlementUpdate,
      },
      checkoutSettlementItem: {
        deleteMany: jest.fn(),
        update: itemUpdate,
      },
      paymentAllocation: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 101,
            paymentId: 11,
            rentBillId: 21,
            allocatedAmount: new Prisma.Decimal('300.00'),
            reversedAmount: new Prisma.Decimal('0.00'),
            payment: {
              paymentDate: new Date('2026-08-05'),
              voidRequests: [],
            },
            rentBill: {
              billNo: 'ZJ2026080001',
              periodStart: new Date('2026-08-01'),
              periodEnd: new Date('2026-08-31'),
            },
            refundAllocations: [],
            checkoutRentRefundAllocations: [],
          },
        ]),
      },
      checkoutRentRefundAllocation: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        createMany: reserveCreateMany,
      },
    };
    const service = new CheckoutService({
      db: {
        $transaction: jest.fn(
          (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
        ),
      },
    } as never);

    const result = await service.submit(
      9,
      {
        actualCheckoutDate: '2026-08-15',
        handoverDate: '2026-08-15',
        inspectionAt: '2026-08-15T09:00:00.000Z',
        targetRoomStatus: 'EMPTY',
        items: [
          {
            itemType: 'RENT_REFUND',
            amount: '200.00',
            description: '再次申请退还租金',
          },
        ],
      } as never,
      user,
    );

    expect(itemUpdate).toHaveBeenCalledWith({
      where: { id: 81 },
      data: expect.objectContaining({
        amount: new Prisma.Decimal('200.00'),
        description: '再次申请退还租金',
      }),
    });
    expect(settlementUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ items: { create: [] } }),
      }),
    );
    expect(reserveCreateMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          checkoutSettlementItemId: 81,
          reservedAmount: new Prisma.Decimal('200.00'),
          status: 'RESERVED',
        }),
      ],
    });
    expect(result.items).toEqual([changedItem]);
  });

  it('hides a historical rent-refund item from detail when the locked amount is zero and no active reservation remains', async () => {
    const findUniqueOrThrow = jest.fn().mockResolvedValue({
      id: 9,
      rentReceivable: new Prisma.Decimal('0.00'),
      rentReceived: new Prisma.Decimal('0.00'),
      rentOutstanding: new Prisma.Decimal('0.00'),
      prepaymentBalance: new Prisma.Decimal('0.00'),
      depositBalance: new Prisma.Decimal('0.00'),
      depositOffsetAmount: new Prisma.Decimal('0.00'),
      otherDeductionAmount: new Prisma.Decimal('0.00'),
      depositRefundableAmount: new Prisma.Decimal('0.00'),
      prepaymentRefundableAmount: new Prisma.Decimal('0.00'),
      rentRefundableAmount: new Prisma.Decimal('0.00'),
      finalReceivable: new Prisma.Decimal('0.00'),
      supplementalRequired: false,
      supplementalArrearsAmount: new Prisma.Decimal('0.00'),
      supplementalInspectionAmount: new Prisma.Decimal('0.00'),
      supplementalReceivedAmount: new Prisma.Decimal('0.00'),
      supplementalOutstandingAmount: new Prisma.Decimal('0.00'),
      supplementalCollectedAt: null,
      contract: { id: 4, room: { id: 7, roomNo: '301' } },
      items: [
        {
          id: 81,
          itemType: 'RENT_REFUND',
          amount: new Prisma.Decimal('100.00'),
          checkoutRentRefundAllocations: [],
        },
      ],
      depositRefunds: [],
    });
    const service = new CheckoutService({
      db: { checkoutSettlement: { findUniqueOrThrow } },
    } as never);

    await expect(service.getDetail(9)).resolves.toMatchObject({
      id: 9,
      rentRefundableAmount: '0.00',
      items: [],
    });
    expect(findUniqueOrThrow).toHaveBeenCalledWith({
      where: { id: 9 },
      include: expect.objectContaining({
        items: {
          orderBy: { sortOrder: 'asc' },
          include: {
            checkoutRentRefundAllocations: {
              where: { status: 'RESERVED' },
              select: { id: true },
            },
          },
        },
      }),
    });
  });
});
