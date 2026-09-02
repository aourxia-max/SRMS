import { PropertyAffairStatus } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsString,
  Length,
  Min,
  ValidateIf,
} from 'class-validator';
import { isDefined, trimRequiredString } from './property-affair-relations.dto';

export class AppendPropertyAffairProgressDto {
  @Type(() => Number)
  @IsInt({ message: '版本号必须为整数' })
  @Min(1, { message: '版本号必须为正整数' })
  version!: number;

  @Transform(trimRequiredString)
  @IsString({ message: '进度内容必须为文本' })
  @Length(1, 2000, { message: '进度内容长度必须为1至2000个字符' })
  content!: string;

  @ValidateIf(isDefined)
  @IsEnum(PropertyAffairStatus, { message: '目标事项状态无效' })
  nextStatus?: PropertyAffairStatus;
}
