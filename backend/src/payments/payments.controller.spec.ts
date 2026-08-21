import { UserRole } from '@prisma/client';
import type { AuthUser } from '../auth/auth-user.type';
import { PaymentsController } from './payments.controller';

describe('PaymentsController', () => {
  const admin: AuthUser = {
    id: 7,
    username: 'admin',
    displayName: 'Admin',
    role: UserRole.ADMIN,
  };

  it('reconciles due contract lifecycle changes before recording a payment', async () => {
    let status = 'PENDING_START';
    const lifecycle = {
      run: jest.fn().mockImplementation(() => {
        status = 'ACTIVE';
        return Promise.resolve({ activated: 1, pendingCheckout: 0 });
      }),
    };
    const payments = {
      record: jest
        .fn()
        .mockImplementation(() => Promise.resolve({ id: 9, status })),
    };
    const controller = Reflect.construct(PaymentsController, [
      payments,
      {},
      lifecycle,
    ]) as PaymentsController;

    await expect(
      controller.record(
        {
          contractId: 15,
          amount: '1000',
          paymentDate: '2026-08-21',
          method: 'CASH',
          allocationMode: 'MANUAL',
          allocations: [{ rentBillId: 1, amount: '1000' }],
        },
        admin,
      ),
    ).resolves.toEqual({
      code: 200,
      message: 'success',
      data: { id: 9, status: 'ACTIVE' },
    });
  });
});
