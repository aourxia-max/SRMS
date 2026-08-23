import { ContractDepositService } from './contract-deposit.service';

const input = {
  contractId: 42,
  amount: '10000.00',
  operatorId: 7,
  occurredAt: new Date('2026-08-23T02:00:00.000Z'),
};

describe('ContractDepositService', () => {
  it('does not create financial records for a zero deposit', async () => {
    const tx = {
      payment: {
        findUnique: jest.fn(),
        create: jest.fn(),
      },
      depositTransaction: { create: jest.fn() },
    };

    await new ContractDepositService().recordInitialDeposit(tx as never, {
      ...input,
      amount: '0.00',
    });

    expect(tx.payment.findUnique).not.toHaveBeenCalled();
    expect(tx.payment.create).not.toHaveBeenCalled();
    expect(tx.depositTransaction.create).not.toHaveBeenCalled();
  });

  it('rejects a deposit whose automatic source already exists', async () => {
    const tx = {
      payment: {
        findUnique: jest.fn().mockResolvedValue({ id: 81 }),
        create: jest.fn(),
      },
      depositTransaction: { create: jest.fn() },
    };

    await expect(
      new ContractDepositService().recordInitialDeposit(tx as never, input),
    ).rejects.toThrow('该合同押金已自动入账，请勿重复提交');
    expect(tx.payment.create).not.toHaveBeenCalled();
    expect(tx.depositTransaction.create).not.toHaveBeenCalled();
  });

  it('translates a concurrent unique-source conflict into a Chinese message', async () => {
    const uniqueError = Object.assign(new Error('unique constraint failed'), {
      code: 'P2002',
    });
    const tx = {
      payment: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockRejectedValue(uniqueError),
      },
      depositTransaction: { create: jest.fn() },
    };

    await expect(
      new ContractDepositService().recordInitialDeposit(tx as never, input),
    ).rejects.toThrow('该合同押金已自动入账，请勿重复提交');
    expect(tx.depositTransaction.create).not.toHaveBeenCalled();
  });
});
