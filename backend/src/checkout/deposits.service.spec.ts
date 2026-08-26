import { PaymentMethod, UserRole } from '@prisma/client';
import { DepositsService } from './deposits.service';

describe('DepositsService', () => {
  it('rejects recording a deposit for a voided contract', async () => {
    const paymentCreate = jest.fn();
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 7 }]),
      contract: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 7,
          status: 'VOIDED',
        }),
      },
      payment: { create: paymentCreate },
    };
    const service = new DepositsService({
      db: {
        $transaction: jest.fn(
          (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
        ),
      },
    } as never);

    await expect(
      service.record(
        {
          contractId: 7,
          paymentDate: '2026-08-26',
          amount: '1000.00',
          method: PaymentMethod.BANK_TRANSFER,
        },
        {
          id: 1,
          username: 'root',
          displayName: '超级管理员',
          role: UserRole.SUPER_ADMIN,
        },
      ),
    ).rejects.toThrow('已作废合同不能登记押金收取');
    expect(paymentCreate).not.toHaveBeenCalled();
  });
});
