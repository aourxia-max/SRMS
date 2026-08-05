import { RentBillStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Min,
} from 'class-validator';

export class ListRentBillsDto {
  @IsOptional() @IsString() keyword?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) buildingId?: number;
  @IsOptional() @IsEnum(RentBillStatus) status?: RentBillStatus;
  @IsOptional() @Matches(/^\d{4}-\d{2}$/) month?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @IsIn([10, 20, 50, 100]) pageSize =
    20;
}
