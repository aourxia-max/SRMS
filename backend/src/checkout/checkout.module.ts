import { Module } from '@nestjs/common';
import { DepositsController } from './deposits.controller';
import { DepositsService } from './deposits.service';
import { CheckoutController } from './checkout.controller';
import { CheckoutService } from './checkout.service';
import { DepositRefundsController } from './deposit-refunds.controller';
import { DepositRefundsService } from './deposit-refunds.service';
import { FilesModule } from '../files/files.module';

@Module({
  imports: [FilesModule],
  controllers: [
    DepositsController,
    CheckoutController,
    DepositRefundsController,
  ],
  providers: [DepositsService, CheckoutService, DepositRefundsService],
})
export class CheckoutModule {}
