import { Type } from 'class-transformer';
import {
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

export class RecordDepositDto {
  @Type(() => Number) @IsInt() @Min(1) contractId!: number;
  @IsDateString() paymentDate!: string;
  @IsNumberString() amount!: string;
  @IsIn(MANUAL_PAYMENT_METHODS) method!: ManualPaymentMethod;
  @IsOptional() @IsString() @Length(1, 100) externalReference?: string;
  @IsOptional() @IsString() @Length(1, 500) remark?: string;
}
