import { RoomStatus } from '@prisma/client';
import { IsEnum, IsOptional, IsString, Length } from 'class-validator';

export class ChangeRoomStatusDto {
  @IsEnum(RoomStatus) roomStatus!: RoomStatus;
  @IsOptional() @IsString() @Length(1, 500) reason?: string;
}
