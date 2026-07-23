import { RoomStatus } from '@prisma/client';
import { IsDateString, IsEnum, IsString, Length } from 'class-validator';

export class InitiateCheckoutDto {
  @IsString() @Length(1, 50) checkoutType!: string;
  @IsDateString() plannedCheckoutDate!: string;
  @IsDateString() handoverDate!: string;
  @IsDateString() inspectionAt!: string;
  @IsString() @Length(1, 500) checkoutReason!: string;
  @IsEnum(RoomStatus) targetRoomStatus!: RoomStatus;
}
