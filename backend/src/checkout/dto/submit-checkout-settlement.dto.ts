import { CheckoutSettlementItemType, RoomStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsNumberString,
  IsOptional,
  IsString,
  Length,
  Min,
  ValidateNested,
} from 'class-validator';

export class CheckoutSettlementItemDto {
  @IsEnum(CheckoutSettlementItemType) itemType!: CheckoutSettlementItemType;
  @IsNumberString() amount!: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) rentBillId?: number;
  @IsOptional() @IsString() @Length(1, 100) inspectionRecordRef?: string;
  @IsString() @Length(1, 500) description!: string;
  @IsOptional() @IsBoolean() evidenceRequired = false;
  @IsOptional() @IsBoolean() confirmedByTenant = false;
}
export class SubmitCheckoutSettlementDto {
  @IsDateString() actualCheckoutDate!: string;
  @IsDateString() handoverDate!: string;
  @IsDateString() inspectionAt!: string;
  @IsEnum(RoomStatus) targetRoomStatus!: RoomStatus;
  @IsOptional() @IsString() @Length(1, 1000) remark?: string;
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CheckoutSettlementItemDto)
  items!: CheckoutSettlementItemDto[];
}
