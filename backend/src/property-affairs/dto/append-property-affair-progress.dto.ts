import { PropertyAffairStatus } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Min,
} from 'class-validator';
import { trimRequiredString } from './property-affair-relations.dto';

export class AppendPropertyAffairProgressDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version!: number;

  @Transform(trimRequiredString)
  @IsString()
  @Length(1, 2000)
  content!: string;

  @IsOptional()
  @IsEnum(PropertyAffairStatus)
  nextStatus?: PropertyAffairStatus;
}
