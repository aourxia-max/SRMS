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
  ValidateIf,
} from 'class-validator';
import { isDefined, trimOptionalString } from './property-affair-relations.dto';

export class ListPropertyAffairsQueryDto {
  @Transform(trimOptionalString)
  @IsOptional()
  @IsString({ message: '关键词必须为文本' })
  @MaxLength(100, { message: '关键词长度不能超过100个字符' })
  keyword?: string;

  @Transform(trimOptionalString)
  @IsOptional()
  @IsString({ message: '分类必须为文本' })
  @MaxLength(80, { message: '分类长度不能超过80个字符' })
  category?: string;

  @ValidateIf(isDefined)
  @IsEnum(PropertyAffairStatus, { message: '事项状态无效' })
  status?: PropertyAffairStatus;

  @ValidateIf(isDefined)
  @IsEnum(PropertyAffairPriority, { message: '优先级无效' })
  priority?: PropertyAffairPriority;

  @Type(() => Number)
  @ValidateIf(isDefined)
  @IsInt({ message: '负责人编号必须为整数' })
  @Min(1, { message: '负责人编号必须为正整数' })
  responsibleUserId?: number;

  @Type(() => Number)
  @ValidateIf(isDefined)
  @IsInt({ message: '楼栋编号必须为整数' })
  @Min(1, { message: '楼栋编号必须为正整数' })
  buildingId?: number;

  @Type(() => Number)
  @ValidateIf(isDefined)
  @IsInt({ message: '房源编号必须为整数' })
  @Min(1, { message: '房源编号必须为正整数' })
  roomId?: number;

  @Type(() => Number)
  @ValidateIf(isDefined)
  @IsInt({ message: '租客编号必须为整数' })
  @Min(1, { message: '租客编号必须为正整数' })
  tenantId?: number;

  @Type(() => Number)
  @ValidateIf(isDefined)
  @IsInt({ message: '合同编号必须为整数' })
  @Min(1, { message: '合同编号必须为正整数' })
  contractId?: number;

  @Type(() => Number)
  @ValidateIf(isDefined)
  @IsInt({ message: '页码必须为整数' })
  @Min(1, { message: '页码必须为正整数' })
  page: number = 1;

  @Type(() => Number)
  @ValidateIf(isDefined)
  @IsInt({ message: '每页条数必须为整数' })
  @Min(1, { message: '每页条数必须为正整数' })
  @Max(100, { message: '每页条数不能超过100' })
  pageSize: number = 20;
}
