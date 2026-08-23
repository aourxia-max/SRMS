import {
  PricingRebateSettlementMethod,
  PricingRebateSourceType,
  PricingRebateType,
} from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsIn,
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

export class SubmitPricingRebateDto {
  @Type(() => Number) @IsInt() @Min(1) contractId!: number;
  @IsIn(['FIXED_RENT_MANUAL']) sourceType!: PricingRebateSourceType;
  @IsEnum(PricingRebateType) rebateType!: PricingRebateType;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) pricingTierId?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) rentBillId?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) parentRebateId?: number;
  @IsDateString() periodStart!: string;
  @IsDateString() periodEnd!: string;
  @IsNumberString() actualAmount!: string;
  @IsEnum(PricingRebateSettlementMethod)
  settlementMethod!: PricingRebateSettlementMethod;
  @IsOptional() @IsDateString() refundDate?: string;
  @IsOptional()
  @IsIn(MANUAL_PAYMENT_METHODS)
  refundMethod?: ManualPaymentMethod;
  @IsOptional() @IsString() @Length(1, 500) differenceReason?: string;
  @IsOptional() @IsString() @Length(1, 1000) remark?: string;
  @IsOptional()
  @IsArray()
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(1, { each: true })
  proofFileIds?: number[];
}
