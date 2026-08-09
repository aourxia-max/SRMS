import { Module } from '@nestjs/common';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { AdjustmentsController } from './adjustments.controller';
import { AdjustmentsService } from './adjustments.service';
import { RefundsController } from './refunds.controller';
import { RefundsService } from './refunds.service';
import { VoidRequestsController } from './void-requests.controller';
import { VoidRequestsService } from './void-requests.service';
import { FilesModule } from '../files/files.module';
import { PaymentReviewsController } from './payment-reviews.controller';
import { PaymentReviewsService } from './payment-reviews.service';

@Module({
  imports: [FilesModule],
  controllers: [
    PaymentsController,
    AdjustmentsController,
    RefundsController,
    VoidRequestsController,
    PaymentReviewsController,
  ],
  providers: [
    PaymentsService,
    AdjustmentsService,
    RefundsService,
    VoidRequestsService,
    PaymentReviewsService,
  ],
})
export class PaymentsModule {}
