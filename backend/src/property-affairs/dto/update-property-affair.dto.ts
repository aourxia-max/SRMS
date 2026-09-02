import { PropertyAffairPriority, PropertyAffairStatus } from '@prisma/client';
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

export class UpdatePropertyAffairDto extends PropertyAffairRelationsDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version!: number;

  @Transform(trimRequiredString)
  @IsOptional()
  @IsString()
  @Length(1, 200)
  title?: string;

  @Transform(trimOptionalString)
  @IsOptional()
  @IsString()
  @MaxLength(80)
  category?: string;

  @IsOptional()
  @IsEnum(PropertyAffairPriority)
  priority?: PropertyAffairPriority;

  @Transform(trimRequiredString)
  @IsOptional()
  @IsString()
  @Length(1, 5000)
  content?: string;

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

  @IsOptional()
  @IsEnum(PropertyAffairStatus)
  status?: PropertyAffairStatus;
}
