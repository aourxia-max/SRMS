import { RoomStatus } from '@prisma/client';
import {
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  Length,
} from 'class-validator';

export class InitiateCheckoutDto {
  @IsOptional()
  @IsDateString({ strict: true }, { message: '实际退房日期格式不正确' })
  actualCheckoutDate?: string;
  @IsString() @Length(1, 50) checkoutType!: string;
  @IsDateString() plannedCheckoutDate!: string;
  @IsDateString() handoverDate!: string;
  @IsDateString() inspectionAt!: string;
  @IsString() @Length(1, 500) checkoutReason!: string;
  @IsEnum(RoomStatus) targetRoomStatus!: RoomStatus;
}
