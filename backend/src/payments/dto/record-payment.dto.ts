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
  ValidateNested,
} from 'class-validator';
import { RecordPaymentAdjustmentDto } from './record-payment-adjustment.dto';

export class RecordPaymentDto {
  @Type(() => Number) @IsInt() @Min(1) contractId!: number;
  @IsDateString() paymentDate!: string;
  @IsNumberString() amount!: string;
  @IsEnum(PaymentMethod) method!: PaymentMethod;
  @IsOptional() @IsString() @Length(1, 100) externalReference?: string;
  @IsOptional() @IsString() @Length(1, 500) remark?: string;
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

  @IsOptional()
  @IsArray()
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(1, { each: true })
  proofFileIds?: number[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RecordPaymentAdjustmentDto)
  adjustments?: RecordPaymentAdjustmentDto[];
}
