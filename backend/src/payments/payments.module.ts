import { Module } from '@nestjs/common';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { AdjustmentsController } from './adjustments.controller';
import { AdjustmentsService } from './adjustments.service';
import { RefundsController } from './refunds.controller';
import { RefundsService } from './refunds.service';
import { VoidRequestsController } from './void-requests.controller';
import { VoidRequestsService } from './void-requests.service';

@Module({
  controllers: [
    PaymentsController,
    AdjustmentsController,
    RefundsController,
    VoidRequestsController,
  ],
  providers: [
    PaymentsService,
    AdjustmentsService,
    RefundsService,
    VoidRequestsService,
  ],
})
export class PaymentsModule {}
