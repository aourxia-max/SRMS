import { Module } from '@nestjs/common';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { FinanceModule } from '../finance/finance.module';
import { PropertyAffairsModule } from '../property-affairs/property-affairs.module';
@Module({
  imports: [FinanceModule, PropertyAffairsModule],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
