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
import { Type } from 'class-transformer';
import { ConcessionApplyMode, ConcessionType } from '@prisma/client';

export class ConcessionDto {
  @IsEnum(ConcessionType) concessionType!: ConcessionType;
  @IsEnum(ConcessionApplyMode) applyMode!: ConcessionApplyMode;
  @IsOptional() @IsDateString() startDate?: string;
  @IsOptional() @IsDateString() endDate?: string;
  @IsOptional() @IsNumberString() fixedAmount?: string;
  @IsOptional() @IsNumberString() discountRate?: string;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  billingPeriodCount?: number;
  @IsString() @Length(1, 500) reason!: string;
}
