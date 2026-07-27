import { ContractLifecycleService } from './contract-lifecycle.service';

describe('ContractLifecycleService', () => {
  const now = new Date('2026-07-27T00:05:00.000Z');

  function createService(input: {
    pending?: Array<Record<string, unknown>>;
    active?: Array<Record<string, unknown>>;
    activationChanged?: number;
    checkoutChanged?: number;
    roomChanged?: number;
  }) {
    const contractUpdateMany = jest.fn((args: { where: { status: string } }) =>
      Promise.resolve({
        count:
          args.where.status === 'PENDING_START'
            ? (input.activationChanged ?? 0)
            : (input.checkoutChanged ?? 0),
      }),
    );
    const roomUpdateMany = jest
      .fn()
      .mockResolvedValue({ count: input.roomChanged ?? 0 });
    const roomStatusHistoryCreate = jest.fn().mockResolvedValue({});
    const tx = {
      contract: { updateMany: contractUpdateMany },
      room: { updateMany: roomUpdateMany },
      roomStatusHistory: { create: roomStatusHistoryCreate },
    };
    const findMany = jest
      .fn()
      .mockResolvedValueOnce(input.pending ?? [])
      .mockResolvedValueOnce(input.active ?? []);
    const prisma = {
      db: {
        contract: { findMany },
        $transaction: jest.fn(
          (callback: (value: typeof tx) => Promise<unknown>) => callback(tx),
        ),
      },
    };
    return {
      service: new ContractLifecycleService(prisma as never),
      findMany,
      contractUpdateMany,
      roomUpdateMany,
      roomStatusHistoryCreate,
    };
  }

  it('activates due pending contracts and records rented room history once', async () => {
    const test = createService({
      pending: [{ id: 1, contractNo: 'TEST-START', roomId: 10 }],
      activationChanged: 1,
      roomChanged: 1,
    });

    await expect(test.service.run(now)).resolves.toEqual({
      activated: 1,
      pendingCheckout: 0,
    });
    expect(test.contractUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 1, status: 'PENDING_START' },
        data: expect.objectContaining({ status: 'ACTIVE', activatedAt: now }),
      }),
    );
    expect(test.roomUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 10, roomStatus: 'PENDING_MOVE_IN' },
        data: { roomStatus: 'RENTED', statusChangedAt: now },
      }),
    );
    expect(test.roomStatusHistoryCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          roomId: 10,
          toStatus: 'RENTED',
          businessType: 'CONTRACT',
          businessId: 1,
        }),
      }),
    );
  });

  it('moves contracts ending today to pending checkout without touching bills', async () => {
    const test = createService({
      active: [{ id: 2, contractNo: 'TEST-END', roomId: 20 }],
      checkoutChanged: 1,
      roomChanged: 1,
    });

    await expect(test.service.run(now)).resolves.toEqual({
      activated: 0,
      pendingCheckout: 1,
    });
    expect(test.contractUpdateMany).toHaveBeenLastCalledWith({
      where: { id: 2, status: 'ACTIVE' },
      data: { status: 'PENDING_CHECKOUT' },
    });
    expect(test.roomUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 20, roomStatus: 'RENTED' },
        data: { roomStatus: 'PENDING_CHECKOUT', statusChangedAt: now },
      }),
    );
  });

  it('does not add history when a concurrent run already changed the contract', async () => {
    const test = createService({
      pending: [{ id: 3, contractNo: 'TEST-IDEMPOTENT', roomId: 30 }],
      activationChanged: 0,
    });

    await expect(test.service.run(now)).resolves.toEqual({
      activated: 0,
      pendingCheckout: 0,
    });
    expect(test.roomUpdateMany).not.toHaveBeenCalled();
    expect(test.roomStatusHistoryCreate).not.toHaveBeenCalled();
  });
});
