import { PropertyAffairPriority, PropertyAffairStatus } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsString,
  Length,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import {
  isDefined,
  PropertyAffairRelationsDto,
  trimOptionalString,
  trimRequiredString,
} from './property-affair-relations.dto';

const isNonNullDefined = (_object: object, value: unknown) =>
  value !== undefined && value !== null;

export class UpdatePropertyAffairDto extends PropertyAffairRelationsDto {
  @Type(() => Number)
  @IsInt({ message: '版本号必须为整数' })
  @Min(1, { message: '版本号必须为正整数' })
  version!: number;

  @Transform(trimRequiredString)
  @ValidateIf(isDefined)
  @IsString({ message: '标题必须为文本' })
  @Length(1, 200, { message: '标题长度必须为1至200个字符' })
  title?: string;

  @Transform(trimOptionalString)
  @ValidateIf(isNonNullDefined)
  @IsString({ message: '分类必须为文本' })
  @MaxLength(80, { message: '分类长度不能超过80个字符' })
  category?: string | null;

  @ValidateIf(isDefined)
  @IsEnum(PropertyAffairPriority, { message: '优先级无效' })
  priority?: PropertyAffairPriority;

  @Transform(trimRequiredString)
  @ValidateIf(isDefined)
  @IsString({ message: '内容必须为文本' })
  @Length(1, 5000, { message: '内容长度必须为1至5000个字符' })
  content?: string;

  @Type(() => Number)
  @ValidateIf(isNonNullDefined)
  @IsInt({ message: '负责人编号必须为整数' })
  @Min(1, { message: '负责人编号必须为正整数' })
  responsibleUserId?: number | null;

  @Transform(trimOptionalString)
  @ValidateIf(isNonNullDefined)
  @IsString({ message: '外部处理人必须为文本' })
  @MaxLength(100, { message: '外部处理人长度不能超过100个字符' })
  externalHandlerName?: string | null;

  @Transform(trimOptionalString)
  @ValidateIf(isNonNullDefined)
  @IsString({ message: '外部联系电话必须为文本' })
  @MaxLength(50, { message: '外部联系电话长度不能超过50个字符' })
  externalPhone?: string | null;

  @Transform(trimOptionalString)
  @ValidateIf(isNonNullDefined)
  @IsString({ message: '其他联系方式必须为文本' })
  @MaxLength(200, { message: '其他联系方式长度不能超过200个字符' })
  externalContact?: string | null;

  @ValidateIf(isDefined)
  @IsEnum(PropertyAffairStatus, { message: '事项状态无效' })
  status?: PropertyAffairStatus;
}
