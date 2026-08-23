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

export class EditPaymentDto {
  @IsOptional()
  @IsDateString()
  paymentDate?: string;

  @IsOptional()
  @IsIn(MANUAL_PAYMENT_METHODS)
  method?: ManualPaymentMethod;

  @IsOptional()
  @IsString()
  @Length(1, 100)
  externalReference?: string | null;

  @IsOptional()
  @IsString()
  @Length(1, 500)
  remark?: string | null;

  @IsOptional()
  @IsNumberString()
  amount?: string;

  @IsOptional()
  @IsArray()
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(1, { each: true })
  selectedBillIds?: number[];

  @IsOptional()
  @IsString()
  @Length(1, 500)
  manualAllocationReason?: string;

  @IsString()
  @Length(1, 500)
  editReason!: string;
}
