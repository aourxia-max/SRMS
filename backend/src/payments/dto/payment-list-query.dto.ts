import { Type } from 'class-transformer';
import {
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Min,
} from 'class-validator';

export class PaymentListQueryDto {
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
  @IsString()
  @Length(1, 40)
  receiptNo?: string;

  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @IsOptional()
  @IsDateString()
  dateTo?: string;
}
