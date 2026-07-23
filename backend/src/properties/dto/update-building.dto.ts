import { BuildingStatus } from '@prisma/client';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Min,
} from 'class-validator';

export class UpdateBuildingDto {
  @IsOptional() @IsString() @Length(1, 20) buildingNo?: string;
  @IsOptional() @IsString() @Length(1, 100) buildingName?: string;
  @IsOptional() @IsInt() @Min(1) floorCount?: number;
  @IsOptional() @IsInt() sortOrder?: number;
  @IsOptional() @IsEnum(BuildingStatus) status?: BuildingStatus;
  @IsOptional() @IsString() @Length(1, 500) remark?: string;
}
