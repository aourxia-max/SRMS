import { BadRequestException, GoneException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PricingRebatesService } from './pricing-rebates.service';

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
function serviceWithContract(pricingMode: 'FIXED' | 'TIERED_RETROACTIVE') {
  return new PricingRebatesService({
    db: {
      contract: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 1,
          status: 'ACTIVE',
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
    },
  } as never);
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
    await expect(
      serviceWithContract('FIXED').submit(fixedManualDto, admin),
    ).resolves.toEqual(
      expect.objectContaining({ sourceType: 'FIXED_RENT_MANUAL' }),
    );
  });
});
