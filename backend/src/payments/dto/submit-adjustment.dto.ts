import { AdjustmentDirection, BillAdjustmentType } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsNumberString,
  IsOptional,
  IsString,
  Length,
  Min,
} from 'class-validator';

export class SubmitAdjustmentDto {
  @Type(() => Number) @IsInt() @Min(1) rentBillId!: number;
  @IsEnum(BillAdjustmentType) adjustmentType!: BillAdjustmentType;
  @IsEnum(AdjustmentDirection) direction!: AdjustmentDirection;
  @IsNumberString() amount!: string;
  @IsString() @Length(1, 500) reason!: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) sourcePaymentId?: number;
}
