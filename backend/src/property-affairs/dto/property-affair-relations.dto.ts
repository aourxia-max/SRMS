import { Type } from 'class-transformer';
import { ArrayUnique, IsArray, IsInt, Min } from 'class-validator';

export const trimRequiredString = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export const trimOptionalString = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') return value;

  const trimmed = value.trim();
  return trimmed || undefined;
};

export const isDefined = (_object: object, value: unknown) =>
  value !== undefined;

export class PropertyAffairRelationsDto {
  @IsArray({ message: '楼栋编号必须为数组' })
  @ArrayUnique({ message: '楼栋编号不能重复' })
  @Type(() => Number)
  @IsInt({ each: true, message: '楼栋编号必须为整数' })
  @Min(1, { each: true, message: '楼栋编号必须为正整数' })
  buildingIds: number[] = [];

  @IsArray({ message: '房源编号必须为数组' })
  @ArrayUnique({ message: '房源编号不能重复' })
  @Type(() => Number)
  @IsInt({ each: true, message: '房源编号必须为整数' })
  @Min(1, { each: true, message: '房源编号必须为正整数' })
  roomIds: number[] = [];

  @IsArray({ message: '租客编号必须为数组' })
  @ArrayUnique({ message: '租客编号不能重复' })
  @Type(() => Number)
  @IsInt({ each: true, message: '租客编号必须为整数' })
  @Min(1, { each: true, message: '租客编号必须为正整数' })
  tenantIds: number[] = [];

  @IsArray({ message: '合同编号必须为数组' })
  @ArrayUnique({ message: '合同编号不能重复' })
  @Type(() => Number)
  @IsInt({ each: true, message: '合同编号必须为整数' })
  @Min(1, { each: true, message: '合同编号必须为正整数' })
  contractIds: number[] = [];
}
