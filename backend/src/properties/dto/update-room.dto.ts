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
import { Transform } from 'class-transformer';

const blankToNull = ({ value }: { value: unknown }) =>
  value === '' ? null : value;

export class UpdateRoomDto {
  @IsOptional() @IsInt() buildingId?: number;
  @IsOptional() @IsString() @Length(1, 30) houseNo?: string;
  @IsOptional() @IsInt() @Min(1) floorNo?: number;
  @IsOptional() @IsEnum(RoomType) roomType?: RoomType;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) area?: number;
  @IsOptional() @IsEnum(DecorationStatus) decorationStatus?: DecorationStatus;
  @IsOptional() @IsEnum(UsageType) usageType?: UsageType;
  @IsOptional() @IsEnum(RoomStatus) roomStatus?: RoomStatus;
  @Transform(blankToNull)
  @IsOptional()
  @IsString()
  @Length(1, 100)
  ownerName?: string | null;

  @Transform(blankToNull)
  @IsOptional()
  @IsString()
  @Length(1, 30)
  ownerPhone?: string | null;

  @Transform(blankToNull)
  @IsOptional()
  @IsString()
  @Length(1, 500)
  ownerRemark?: string | null;

  @Transform(blankToNull)
  @IsOptional()
  @IsString()
  @Length(1, 500)
  remark?: string | null;
}
