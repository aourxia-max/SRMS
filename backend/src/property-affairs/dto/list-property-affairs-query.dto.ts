import { PropertyAffairPriority, PropertyAffairStatus } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { trimOptionalString } from './property-affair-relations.dto';

export class ListPropertyAffairsQueryDto {
  @Transform(trimOptionalString)
  @IsOptional()
  @IsString()
  @MaxLength(100)
  keyword?: string;

  @Transform(trimOptionalString)
  @IsOptional()
  @IsString()
  @MaxLength(80)
  category?: string;

  @IsOptional()
  @IsEnum(PropertyAffairStatus)
  status?: PropertyAffairStatus;

  @IsOptional()
  @IsEnum(PropertyAffairPriority)
  priority?: PropertyAffairPriority;

  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  responsibleUserId?: number;

  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  buildingId?: number;

  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  roomId?: number;

  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  tenantId?: number;

  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  contractId?: number;

  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  page: number = 1;

  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize: number = 10;
}
