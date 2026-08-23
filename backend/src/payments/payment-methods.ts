import { PaymentMethod } from '@prisma/client';

export const MANUAL_PAYMENT_METHODS = [
  PaymentMethod.WECHAT,
  PaymentMethod.ALIPAY,
  PaymentMethod.BANK_TRANSFER,
  PaymentMethod.CASH,
  PaymentMethod.POS,
  PaymentMethod.OTHER,
] as const;

export type ManualPaymentMethod = (typeof MANUAL_PAYMENT_METHODS)[number];
