import { RefundAdjustmentDecision } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Min,
  ValidateNested,
} from 'class-validator';

export class RefundAdjustmentDecisionDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  billAdjustmentId!: number;

  @IsEnum(RefundAdjustmentDecision)
  decision!: RefundAdjustmentDecision;

  @IsOptional()
  @IsString()
  @Length(1, 500)
  keepReason?: string;
}

export class ApproveRefundDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RefundAdjustmentDecisionDto)
  adjustmentDecisions!: RefundAdjustmentDecisionDto[];
}
