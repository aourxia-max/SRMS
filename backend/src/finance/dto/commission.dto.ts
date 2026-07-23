import { Type } from 'class-transformer';
import { IsInt, IsNumberString, IsString, Length, Min } from 'class-validator';
export class CreateCommissionDto {
  @Type(() => Number) @IsInt() @Min(1) contractId!: number;
  @IsString() @Length(1, 120) recipientName!: string;
  @IsNumberString() amount!: string;
}
export class UpdateCommissionDto {
  @IsString() @Length(1, 120) recipientName!: string;
  @IsNumberString() amount!: string;
}
