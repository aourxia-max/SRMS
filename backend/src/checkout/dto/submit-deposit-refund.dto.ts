import { Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsNumberString,
  IsOptional,
  IsString,
  Length,
  Min,
} from 'class-validator';
import {
  MANUAL_PAYMENT_METHODS,
  type ManualPaymentMethod,
} from '../../payments/payment-methods';
export class SubmitDepositRefundDto {
  @Type(() => Number) @IsInt() @Min(1) checkoutSettlementId!: number;
  @IsNumberString() refundAmount!: string;
  @IsDateString() refundDate!: string;
  @IsIn(MANUAL_PAYMENT_METHODS) refundMethod!: ManualPaymentMethod;
  @IsOptional() @IsString() @Length(1, 1000) remark?: string;
  @IsArray()
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(1, { each: true })
  proofFileIds!: number[];
}
