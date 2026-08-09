import { ApprovalStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Min,
} from 'class-validator';

export class PaymentReviewQueryDto {
  @IsOptional()
  @IsIn(['REFUND', 'VOID'])
  type?: 'REFUND' | 'VOID';

  @IsOptional()
  @IsEnum(ApprovalStatus)
  status?: ApprovalStatus;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  contractId?: number;

  @IsOptional()
  @IsString()
  @Length(1, 100)
  roomKeyword?: string;

  @IsOptional()
  @IsString()
  @Length(1, 100)
  tenantKeyword?: string;

  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @IsOptional()
  @IsDateString()
  dateTo?: string;
}
