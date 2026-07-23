import {
  DecorationStatus,
  RoomStatus,
  RoomType,
  UsageType,
} from '@prisma/client';
import {
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Min,
} from 'class-validator';
export class CreateRoomDto {
  @IsInt() buildingId!: number;
  @IsString() @Length(1, 30) houseNo!: string;
  @IsInt() @Min(1) floorNo!: number;
  @IsEnum(RoomType) roomType!: RoomType;
  @IsEnum(DecorationStatus) decorationStatus!: DecorationStatus;
  @IsEnum(UsageType) usageType!: UsageType;
  @IsOptional() @IsEnum(RoomStatus) roomStatus?: RoomStatus;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) area?: number;
  @IsOptional() @IsString() @Length(1, 100) ownerName?: string;
  @IsOptional() @IsString() @Length(1, 30) ownerPhone?: string;
  @IsOptional() @IsString() @Length(1, 500) ownerRemark?: string;
  @IsOptional() @IsString() @Length(1, 500) remark?: string;
}
