import { BadRequestException } from '@nestjs/common';
import { CheckoutService } from './checkout.service';

describe('CheckoutService', () => {
  const user = { id: 2, username: 'admin', role: 'ADMIN' } as const;

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
      db: { $transaction: jest.fn((callback) => callback(tx)) },
    } as never);

    await service.approve(1, { ...user, role: 'SUPER_ADMIN' });

    expect(contractUpdate).not.toHaveBeenCalled();
    expect(roomUpdate).not.toHaveBeenCalled();
  });
});
