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

export class EditPaymentDto {
  @IsOptional()
  @IsDateString()
  paymentDate?: string;

  @IsOptional()
  @IsEnum(PaymentMethod)
  method?: PaymentMethod;

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
