import { IsDateString, IsOptional } from 'class-validator';

export class CheckoutFinanceSnapshotQueryDto {
  @IsOptional()
  @IsDateString()
  actualCheckoutDate?: string;
}
