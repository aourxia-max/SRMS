import {
  PaymentMethod,
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
  IsNumberString,
  IsOptional,
  IsString,
  Length,
  Min,
} from 'class-validator';

export class SubmitPricingRebateDto {
  @Type(() => Number) @IsInt() @Min(1) contractId!: number;
  @IsEnum(PricingRebateSourceType) sourceType!: PricingRebateSourceType;
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
  @IsOptional() @IsEnum(PaymentMethod) refundMethod?: PaymentMethod;
  @IsOptional() @IsString() @Length(1, 500) differenceReason?: string;
  @IsOptional() @IsString() @Length(1, 1000) remark?: string;
  @IsOptional()
  @IsArray()
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(1, { each: true })
  proofFileIds?: number[];
}
