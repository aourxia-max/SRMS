import { IsString, Length } from 'class-validator';
export class RejectCheckoutSettlementDto {
  @IsString() @Length(1, 500) reason!: string;
}
