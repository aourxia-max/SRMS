import { IsDateString, IsOptional } from 'class-validator';

export class CheckoutFinanceSnapshotQueryDto {
  @IsOptional()
  @IsDateString({ strict: true }, { message: '实际退房日期格式不正确' })
  actualCheckoutDate?: string;
}
