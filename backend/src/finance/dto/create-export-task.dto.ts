import { ExportFormat } from '@prisma/client';
import { IsEnum, IsIn, IsOptional, IsString } from 'class-validator';

export class CreateExportTaskDto {
  @IsIn(['overview', 'rent-collection', 'cash-flows', 'commissions'])
  reportType!: 'overview' | 'rent-collection' | 'cash-flows' | 'commissions';

  @IsEnum(ExportFormat)
  format!: ExportFormat;

  @IsOptional()
  @IsString()
  from?: string;

  @IsOptional()
  @IsString()
  to?: string;
}
