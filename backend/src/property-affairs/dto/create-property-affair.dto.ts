import {
  PropertyAffairPriority,
  PropertyAffairVisibilityScope,
} from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsEnum,
  IsInt,
  IsString,
  Length,
  MaxLength,
  Min,
  ValidateIf,
  Validate,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import {
  isDefined,
  PropertyAffairRelationsDto,
  trimOptionalString,
  trimRequiredString,
} from './property-affair-relations.dto';

@ValidatorConstraint({ name: 'restrictedViewerIdsRequired', async: false })
class RestrictedViewerIdsRequired implements ValidatorConstraintInterface {
  validate(_value: unknown, args: ValidationArguments) {
    const dto = args.object as {
      visibilityScope?: PropertyAffairVisibilityScope;
      viewerUserIds?: number[];
    };
    return (
      dto.visibilityScope !== PropertyAffairVisibilityScope.RESTRICTED ||
      (Array.isArray(dto.viewerUserIds) && dto.viewerUserIds.length > 0)
    );
  }

  defaultMessage() {
    return '受限可见范围至少需要一名查看人';
  }
}
export class CreatePropertyAffairDto extends PropertyAffairRelationsDto {
  @Validate(RestrictedViewerIdsRequired)
  @IsEnum(PropertyAffairVisibilityScope, { message: '可见范围无效' })
  visibilityScope?: PropertyAffairVisibilityScope =
    PropertyAffairVisibilityScope.ALL;

  @ValidateIf(isDefined)
  @IsArray({ message: '查看人编号必须为数组' })
  @ArrayUnique({ message: '查看人编号不能重复' })
  @Type(() => Number)
  @IsInt({ each: true, message: '查看人编号必须为整数' })
  @Min(1, { each: true, message: '查看人编号必须为正整数' })
  viewerUserIds?: number[] = [];
  @Transform(trimRequiredString)
  @IsString({ message: '标题必须为文本' })
  @Length(1, 200, { message: '标题长度必须为1至200个字符' })
  title!: string;

  @Transform(trimOptionalString)
  @ValidateIf(isDefined)
  @IsString({ message: '分类必须为文本' })
  @MaxLength(80, { message: '分类长度不能超过80个字符' })
  category?: string;

  @IsEnum(PropertyAffairPriority, { message: '优先级无效' })
  priority: PropertyAffairPriority = PropertyAffairPriority.NORMAL;

  @Transform(trimRequiredString)
  @IsString({ message: '内容必须为文本' })
  @Length(1, 5000, { message: '内容长度必须为1至5000个字符' })
  content!: string;

  @Type(() => Number)
  @ValidateIf(isDefined)
  @IsInt({ message: '负责人编号必须为整数' })
  @Min(1, { message: '负责人编号必须为正整数' })
  responsibleUserId?: number;

  @Transform(trimOptionalString)
  @ValidateIf(isDefined)
  @IsString({ message: '外部处理人必须为文本' })
  @MaxLength(100, { message: '外部处理人长度不能超过100个字符' })
  externalHandlerName?: string;

  @Transform(trimOptionalString)
  @ValidateIf(isDefined)
  @IsString({ message: '外部联系电话必须为文本' })
  @MaxLength(50, { message: '外部联系电话长度不能超过50个字符' })
  externalPhone?: string;

  @Transform(trimOptionalString)
  @ValidateIf(isDefined)
  @IsString({ message: '其他联系方式必须为文本' })
  @MaxLength(200, { message: '其他联系方式长度不能超过200个字符' })
  externalContact?: string;
}
