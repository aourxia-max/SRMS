import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
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
});
