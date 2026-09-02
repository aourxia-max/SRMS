import { Type } from 'class-transformer';
import { ArrayUnique, IsArray, IsInt, Min } from 'class-validator';

export const trimRequiredString = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export const trimOptionalString = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') return value;

  const trimmed = value.trim();
  return trimmed || undefined;
};

export class PropertyAffairRelationsDto {
  @IsArray()
  @ArrayUnique()
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(1, { each: true })
  buildingIds: number[] = [];

  @IsArray()
  @ArrayUnique()
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(1, { each: true })
  roomIds: number[] = [];

  @IsArray()
  @ArrayUnique()
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(1, { each: true })
  tenantIds: number[] = [];

  @IsArray()
  @ArrayUnique()
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(1, { each: true })
  contractIds: number[] = [];
}
