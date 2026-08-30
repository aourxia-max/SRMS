import { CheckoutSettlementItemType, RoomStatus } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
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
  Matches,
  Min,
  ValidateNested,
} from 'class-validator';

export const CHECKOUT_SETTLEMENT_AMOUNT_PATTERN =
  /^(?=.*[1-9])\d{1,12}(?:\.\d{1,2})?$/;
export const CHECKOUT_SETTLEMENT_AMOUNT_MESSAGE =
  '结算项目金额必须是大于零、最多12位整数和2位小数的普通十进制字符串';

export class CheckoutSettlementItemDto {
  @IsEnum(CheckoutSettlementItemType) itemType!: CheckoutSettlementItemType;
  @IsNumberString({}, { message: CHECKOUT_SETTLEMENT_AMOUNT_MESSAGE })
  @Matches(CHECKOUT_SETTLEMENT_AMOUNT_PATTERN, {
    message: CHECKOUT_SETTLEMENT_AMOUNT_MESSAGE,
  })
  amount!: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) rentBillId?: number;
  @IsOptional() @IsString() @Length(1, 100) inspectionRecordRef?: string;
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Length(1, 500)
  description!: string;
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
