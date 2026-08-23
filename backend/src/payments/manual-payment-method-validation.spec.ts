import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { RecordDepositDto } from '../checkout/dto/record-deposit.dto';
import { SubmitDepositRefundDto } from '../checkout/dto/submit-deposit-refund.dto';
import { SubmitPricingRebateDto } from '../pricing-rebates/dto/submit-pricing-rebate.dto';
import { EditPaymentDto } from './dto/edit-payment.dto';
import { RecordCheckoutSupplementalPaymentDto } from './dto/record-checkout-supplemental-payment.dto';
import { RecordPaymentDto } from './dto/record-payment.dto';
import { SubmitRefundDto } from './dto/submit-refund.dto';

const cases: Array<{
  name: string;
  type: new () => object;
  methodProperty: 'method' | 'refundMethod';
  payload: Record<string, unknown>;
}> = [
  {
    name: '租金收款',
    type: RecordPaymentDto,
    methodProperty: 'method',
    payload: {
      contractId: 1,
      paymentDate: '2026-08-23',
      amount: '100.00',
      method: 'SYSTEM_AUTO',
    },
  },
  {
    name: '退租补收',
    type: RecordCheckoutSupplementalPaymentDto,
    methodProperty: 'method',
    payload: {
      checkoutSettlementId: 1,
      paymentDate: '2026-08-23',
      amount: '100.00',
      method: 'SYSTEM_AUTO',
    },
  },
  {
    name: '收款更正',
    type: EditPaymentDto,
    methodProperty: 'method',
    payload: {
      method: 'SYSTEM_AUTO',
      editReason: '测试内部方式保护',
    },
  },
  {
    name: '收款退款',
    type: SubmitRefundDto,
    methodProperty: 'refundMethod',
    payload: {
      paymentId: 1,
      refundAmount: '100.00',
      refundDate: '2026-08-23',
      refundMethod: 'SYSTEM_AUTO',
      reason: '测试内部方式保护',
      allocations: [],
    },
  },
  {
    name: '押金收取',
    type: RecordDepositDto,
    methodProperty: 'method',
    payload: {
      contractId: 1,
      paymentDate: '2026-08-23',
      amount: '100.00',
      method: 'SYSTEM_AUTO',
    },
  },
  {
    name: '押金退款',
    type: SubmitDepositRefundDto,
    methodProperty: 'refundMethod',
    payload: {
      checkoutSettlementId: 1,
      refundAmount: '100.00',
      refundDate: '2026-08-23',
      refundMethod: 'SYSTEM_AUTO',
      proofFileIds: [1],
    },
  },
  {
    name: '固定月租退差',
    type: SubmitPricingRebateDto,
    methodProperty: 'refundMethod',
    payload: {
      contractId: 1,
      sourceType: 'FIXED_RENT_MANUAL',
      rebateType: 'MANUAL',
      periodStart: '2026-08-01',
      periodEnd: '2026-08-23',
      actualAmount: '100.00',
      settlementMethod: 'ACTUAL_REFUND',
      refundDate: '2026-08-23',
      refundMethod: 'SYSTEM_AUTO',
    },
  },
];

describe('manual payment method validation', () => {
  it.each(cases)(
    '$name rejects the internal automatic method',
    async (item) => {
      const dto = plainToInstance(item.type, item.payload);
      const errors = await validate(dto, {
        whitelist: true,
        forbidNonWhitelisted: true,
      });

      expect(
        errors.some((error) => error.property === item.methodProperty),
      ).toBe(true);
    },
  );
});
