import 'reflect-metadata';
import { PaymentMethod } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PaymentListQueryDto } from './payment-list-query.dto';
import { RecordPaymentDto } from './record-payment.dto';

const validateDto = (dto: object) =>
  validate(dto, { whitelist: true, forbidNonWhitelisted: true });

describe('payment DTO validation', () => {
  it('accepts an atomic payment request with adjustments and proof ids', async () => {
    const dto = plainToInstance(RecordPaymentDto, {
      contractId: 7,
      paymentDate: '2026-08-04',
      amount: '5700.00',
      method: PaymentMethod.BANK_TRANSFER,
      selectedBillIds: [11, 12],
      manualAllocationReason: '租户指定账期，已复核',
      proofFileIds: [31],
      adjustments: [
        {
          rentBillId: 12,
          adjustmentType: 'DISCOUNT',
          amount: '300.00',
          reason: '经批准的租金优惠',
        },
      ],
    });

    expect(await validateDto(dto)).toHaveLength(0);
  });

  it('rejects an increase disguised as a collection-time discount', async () => {
    const dto = plainToInstance(RecordPaymentDto, {
      contractId: 7,
      paymentDate: '2026-08-04',
      amount: '100.00',
      method: PaymentMethod.CASH,
      adjustments: [
        {
          rentBillId: 12,
          adjustmentType: 'INCREASE',
          amount: '10.00',
          reason: 'invalid',
        },
      ],
    });

    expect(await validateDto(dto)).not.toHaveLength(0);
  });

  it('validates payment list date filters', async () => {
    const valid = plainToInstance(PaymentListQueryDto, {
      contractId: '7',
      dateFrom: '2026-08-01',
      dateTo: '2026-08-31',
    });
    const invalid = plainToInstance(PaymentListQueryDto, {
      dateFrom: '08/01/2026',
    });

    expect(await validateDto(valid)).toHaveLength(0);
    expect(await validateDto(invalid)).not.toHaveLength(0);
  });
});
