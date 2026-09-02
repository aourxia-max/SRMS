import { PropertyAffairPriority } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Length,
  MaxLength,
  Min,
} from 'class-validator';
import {
  PropertyAffairRelationsDto,
  trimOptionalString,
  trimRequiredString,
} from './property-affair-relations.dto';

export class CreatePropertyAffairDto extends PropertyAffairRelationsDto {
  @Transform(trimRequiredString)
  @IsString()
  @Length(1, 200)
  title!: string;

  @Transform(trimOptionalString)
  @IsOptional()
  @IsString()
  @MaxLength(80)
  category?: string;

  @IsEnum(PropertyAffairPriority)
  priority: PropertyAffairPriority = PropertyAffairPriority.NORMAL;

  @Transform(trimRequiredString)
  @IsString()
  @Length(1, 5000)
  content!: string;

  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  responsibleUserId?: number;

  @Transform(trimOptionalString)
  @IsOptional()
  @IsString()
  @MaxLength(100)
  externalHandlerName?: string;

  @Transform(trimOptionalString)
  @IsOptional()
  @IsString()
  @MaxLength(50)
  externalPhone?: string;

  @Transform(trimOptionalString)
  @IsOptional()
  @IsString()
  @MaxLength(200)
  externalContact?: string;
}
