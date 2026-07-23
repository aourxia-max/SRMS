import { PaymentMethod } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsNumberString,
  IsString,
  Length,
  Min,
  ValidateNested,
} from 'class-validator';

export class RefundAllocationDto {
  @Type(() => Number) @IsInt() @Min(1) paymentAllocationId!: number;
  @IsNumberString() amount!: string;
}
export class SubmitRefundDto {
  @Type(() => Number) @IsInt() @Min(1) paymentId!: number;
  @IsNumberString() refundAmount!: string;
  @IsDateString() refundDate!: string;
  @IsEnum(PaymentMethod) refundMethod!: PaymentMethod;
  @IsString() @Length(1, 500) reason!: string;
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RefundAllocationDto)
  allocations!: RefundAllocationDto[];
}
