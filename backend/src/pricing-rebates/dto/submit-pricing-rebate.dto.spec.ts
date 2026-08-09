import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SubmitPricingRebateDto } from './submit-pricing-rebate.dto';

describe('SubmitPricingRebateDto', () => {
  it('does not accept the retired tier milestone source type', async () => {
    const dto = plainToInstance(SubmitPricingRebateDto, {
      contractId: 1,
      sourceType: 'TIER_MILESTONE',
      rebateType: 'MILESTONE',
      periodStart: '2026-08-01',
      periodEnd: '2026-08-31',
      actualAmount: '100',
      settlementMethod: 'PREPAYMENT_CREDIT',
    });

    const errors = await validate(dto);

    expect(errors.some((error) => error.property === 'sourceType')).toBe(true);
  });
});
