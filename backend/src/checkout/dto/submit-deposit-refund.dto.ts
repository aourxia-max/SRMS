import { PaymentMethod } from '@prisma/client';
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
export class SubmitDepositRefundDto {
  @Type(() => Number) @IsInt() @Min(1) checkoutSettlementId!: number;
  @IsNumberString() refundAmount!: string;
  @IsDateString() refundDate!: string;
  @IsEnum(PaymentMethod) refundMethod!: PaymentMethod;
  @IsOptional() @IsString() @Length(1, 1000) remark?: string;
  @IsArray()
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(1, { each: true })
  proofFileIds!: number[];
}
