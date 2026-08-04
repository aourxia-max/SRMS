import { BillAdjustmentType } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNumberString,
  IsString,
  Length,
  Min,
} from 'class-validator';

export class RecordPaymentAdjustmentDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  rentBillId!: number;

  @IsIn([BillAdjustmentType.DISCOUNT, BillAdjustmentType.WAIVER])
  adjustmentType!: BillAdjustmentType;

  @IsNumberString()
  amount!: string;

  @IsString()
  @Length(1, 500)
  reason!: string;
}
