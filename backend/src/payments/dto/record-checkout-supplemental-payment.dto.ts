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
} from '../payment-methods';

export class RecordCheckoutSupplementalPaymentDto {
  @Type(() => Number) @IsInt() @Min(1) checkoutSettlementId!: number;
  @IsDateString() paymentDate!: string;
  @IsNumberString() amount!: string;
  @IsIn(MANUAL_PAYMENT_METHODS) method!: ManualPaymentMethod;
  @IsOptional() @IsString() @Length(1, 100) externalReference?: string;
  @IsOptional() @IsString() @Length(1, 500) remark?: string;
  @IsOptional()
  @IsArray()
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(1, { each: true })
  proofFileIds?: number[];
}
