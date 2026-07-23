import { Module } from '@nestjs/common';
import { FilesModule } from '../files/files.module';
import { PricingRebatesController } from './pricing-rebates.controller';
import { PricingRebatesService } from './pricing-rebates.service';

@Module({
  imports: [FilesModule],
  controllers: [PricingRebatesController],
  providers: [PricingRebatesService],
})
export class PricingRebatesModule {}
