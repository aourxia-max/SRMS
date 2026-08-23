import { Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsNumberString,
  IsString,
  Length,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  MANUAL_PAYMENT_METHODS,
  type ManualPaymentMethod,
} from '../payment-methods';

export class RefundAllocationDto {
  @Type(() => Number) @IsInt() @Min(1) paymentAllocationId!: number;
  @IsNumberString() amount!: string;
}
export class SubmitRefundDto {
  @Type(() => Number) @IsInt() @Min(1) paymentId!: number;
  @IsNumberString() refundAmount!: string;
  @IsDateString() refundDate!: string;
  @IsIn(MANUAL_PAYMENT_METHODS) refundMethod!: ManualPaymentMethod;
  @IsString() @Length(1, 500) reason!: string;
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RefundAllocationDto)
  allocations!: RefundAllocationDto[];
}
