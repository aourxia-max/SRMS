import { PaymentMethod } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsNumberString,
  IsOptional,
  IsString,
  Length,
  Min,
} from 'class-validator';

export class RecordCheckoutSupplementalPaymentDto {
  @Type(() => Number) @IsInt() @Min(1) checkoutSettlementId!: number;
  @IsDateString() paymentDate!: string;
  @IsNumberString() amount!: string;
  @IsEnum(PaymentMethod) method!: PaymentMethod;
  @IsOptional() @IsString() @Length(1, 100) externalReference?: string;
  @IsOptional() @IsString() @Length(1, 500) remark?: string;
}
