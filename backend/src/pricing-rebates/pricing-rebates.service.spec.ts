import { BadRequestException, GoneException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PricingRebatesService } from './pricing-rebates.service';

function expectContractMutationOrder(
  entry: string,
  contractLock: jest.Mock,
  reload: jest.Mock,
  firstWrite: jest.Mock,
) {
  const sql = contractLock.mock.calls[0]?.[0] as
    { strings?: readonly string[] } | undefined;
  const statement = sql?.strings?.join('?') ?? '';
  const lockOrder = contractLock.mock.invocationCallOrder[0];
  const reloadOrder = reload.mock.invocationCallOrder.at(-1);
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

const admin = {
  id: 7,
  role: UserRole.ADMIN,
  username: 'admin',
  displayName: 'Admin',
};
const fixedManualDto = {
  contractId: 1,
  sourceType: 'FIXED_RENT_MANUAL' as const,
  rebateType: 'MANUAL' as const,
  rentBillId: 9,
  periodStart: '2026-08-01',
  periodEnd: '2026-08-31',
  actualAmount: '100',
  settlementMethod: 'PREPAYMENT_CREDIT' as const,
};
function rebateFixture(
  pricingMode: 'FIXED' | 'TIERED_RETROACTIVE',
  status = 'ACTIVE',
) {
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([{ id: 1 }]),
    contract: {
      findUniqueOrThrow: jest.fn().mockResolvedValue({
        id: 1,
        status,
        pricingMode,
        bills: [{ id: 9, status: 'ISSUED' }],
        pricingTiers: [],
        pricingRebates: [],
      }),
    },
    payment: {
      aggregate: jest.fn().mockResolvedValue({ _sum: { amount: '500' } }),
    },
    paymentRefund: {
      aggregate: jest.fn().mockResolvedValue({ _sum: { refundAmount: '0' } }),
    },
    pricingRebate: {
      aggregate: jest.fn().mockResolvedValue({ _sum: { actualAmount: '0' } }),
      create: jest
        .fn()
        .mockImplementation(({ data }) =>
          Promise.resolve({ ...data, files: [] }),
        ),
    },
    fileAsset: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const service = new PricingRebatesService({
    db: {
      ...tx,
      $transaction: jest.fn(
        (callback: (value: typeof tx) => Promise<unknown>) => callback(tx),
      ),
    },
  } as never);
  return { service, tx };
}
function serviceWithContract(
  pricingMode: 'FIXED' | 'TIERED_RETROACTIVE',
  status = 'ACTIVE',
) {
  return rebateFixture(pricingMode, status).service;
}

describe('PricingRebatesService', () => {
  it('serializes uploaded proof file sizes for JSON responses', async () => {
    const findMany = jest.fn().mockResolvedValue([
      {
        id: 1,
        files: [
          {
            id: 1,
            fileAsset: { id: 1, sizeBytes: 42n },
          },
        ],
      },
    ]);
    const service = new PricingRebatesService({
      db: { pricingRebate: { findMany } },
    } as never);

    const result = await service.list();

    expect(result[0].files[0].fileAsset.sizeBytes).toBe('42');
  });
  it('retires tier milestone rebates even when DTO validation is bypassed', async () => {
    await expect(
      serviceWithContract('TIERED_RETROACTIVE').submit(
        { ...fixedManualDto, sourceType: 'TIER_MILESTONE' } as never,
        admin,
      ),
    ).rejects.toEqual(
      expect.objectContaining({
        message: '阶梯退差功能已停用',
        status: 410,
      } as Partial<GoneException>),
    );
  });

  it('rejects manual rebates for a tiered contract', async () => {
    await expect(
      serviceWithContract('TIERED_RETROACTIVE').submit(fixedManualDto, admin),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('continues to submit a fixed-rent manual rebate', async () => {
    const submit = rebateFixture('FIXED');
    await expect(submit.service.submit(fixedManualDto, admin)).resolves.toEqual(
      expect.objectContaining({ sourceType: 'FIXED_RENT_MANUAL' }),
    );
    expectContractMutationOrder(
      'pricingRebate.submit',
      submit.tx.$queryRaw,
      submit.tx.contract.findUniqueOrThrow,
      submit.tx.pricingRebate.create,
    );
  });

  it('orders rebate approve as contract lock, rebate reload, then prepayment write', async () => {
    const firstWriteError = new Error('pricing rebate approve write reached');
    const firstWrite = jest.fn().mockRejectedValue(firstWriteError);
    const reload = jest.fn().mockResolvedValue({
      id: 21,
      contractId: 1,
      rebateNo: 'TC21',
      approvalStatus: 'PENDING',
      settlementMethod: 'PREPAYMENT_CREDIT',
      actualAmount: '100.00',
      files: [],
      contract: { status: 'ACTIVE' },
    });
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 1 }]),
      pricingRebate: {
        findUniqueOrThrow: reload,
        update: jest.fn(),
      },
      prepaymentTransaction: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: firstWrite,
      },
    };
    const service = new PricingRebatesService({
      db: {
        $transaction: jest.fn(
          (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
        ),
      },
    } as never);

    await expect(service.approve(21, admin)).rejects.toBe(firstWriteError);

    expectContractMutationOrder(
      'pricingRebate.approve',
      tx.$queryRaw,
      reload,
      firstWrite,
    );
  });

  it('orders rebate reject as contract lock, rebate reload, then rejection write', async () => {
    const firstWriteError = new Error('pricing rebate reject write reached');
    const firstWrite = jest.fn().mockRejectedValue(firstWriteError);
    const reload = jest.fn().mockResolvedValue({
      id: 21,
      approvalStatus: 'PENDING',
      contract: { status: 'ACTIVE' },
    });
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 1 }]),
      pricingRebate: {
        findUniqueOrThrow: reload,
        update: firstWrite,
      },
    };
    const service = new PricingRebatesService({
      db: {
        $transaction: jest.fn(
          (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
        ),
      },
    } as never);

    await expect(service.reject(21, '信息有误', admin)).rejects.toBe(
      firstWriteError,
    );

    expectContractMutationOrder(
      'pricingRebate.reject',
      tx.$queryRaw,
      reload,
      firstWrite,
    );
  });

  it('rejects every rebate mutation for a voided contract', async () => {
    const submit = rebateFixture('FIXED', 'VOIDED');
    await expect(submit.service.submit(fixedManualDto, admin)).rejects.toThrow(
      '已作废合同不能提交租金退差',
    );
    expect(submit.tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      submit.tx.contract.findUniqueOrThrow.mock.invocationCallOrder[0],
    );
    expect(submit.tx.pricingRebate.create).not.toHaveBeenCalled();

    const approveUpdate = jest.fn();
    const approveTx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 1 }]),
      pricingRebate: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 21,
          contractId: 1,
          rebateNo: 'TC21',
          approvalStatus: 'PENDING',
          settlementMethod: 'PREPAYMENT_CREDIT',
          actualAmount: '100.00',
          files: [],
          contract: { status: 'VOIDED' },
        }),
        update: approveUpdate,
      },
      prepaymentTransaction: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn(),
      },
    };
    const approveService = new PricingRebatesService({
      db: {
        $transaction: jest.fn(
          (callback: (value: typeof approveTx) => Promise<unknown>) =>
            callback(approveTx),
        ),
      },
    } as never);

    await expect(approveService.approve(21, admin)).rejects.toThrow(
      '已作废合同不能确认租金退差',
    );
    expect(approveTx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      approveTx.pricingRebate.findUniqueOrThrow.mock.invocationCallOrder[0],
    );
    expect(approveTx.$queryRaw).toHaveBeenCalledTimes(2);
    expect(approveTx.prepaymentTransaction.create).not.toHaveBeenCalled();
    expect(approveUpdate).not.toHaveBeenCalled();

    const rejectUpdate = jest.fn();
    const rejectTx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 1 }]),
      pricingRebate: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 21,
          approvalStatus: 'PENDING',
          contract: { status: 'VOIDED' },
        }),
        update: rejectUpdate,
      },
    };
    const rejectService = new PricingRebatesService({
      db: {
        $transaction: jest.fn(
          (callback: (value: typeof rejectTx) => Promise<unknown>) =>
            callback(rejectTx),
        ),
      },
    } as never);

    await expect(rejectService.reject(21, '信息有误', admin)).rejects.toThrow(
      '已作废合同不能驳回租金退差',
    );
    expect(rejectTx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      rejectTx.pricingRebate.findUniqueOrThrow.mock.invocationCallOrder[0],
    );
    expect(rejectTx.$queryRaw).toHaveBeenCalledTimes(2);
    expect(rejectUpdate).not.toHaveBeenCalled();
  });
});
