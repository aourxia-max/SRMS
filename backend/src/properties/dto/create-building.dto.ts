import { IsInt, IsOptional, IsString, Length, Min } from 'class-validator';

export class CreateBuildingDto {
  @IsString() @Length(1, 20) buildingNo!: string;
  @IsOptional() @IsString() @Length(1, 100) buildingName?: string;
  @IsInt() @Min(1) floorCount!: number;
  @IsOptional() @IsInt() sortOrder?: number;
  @IsOptional() @IsString() @Length(1, 500) remark?: string;
}
