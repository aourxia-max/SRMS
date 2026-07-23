import { Module } from '@nestjs/common';
import { CommissionsController } from './commissions.controller';
import { CommissionsService } from './commissions.service';
import { FinanceController } from './finance.controller';
import { FinanceService } from './finance.service';
import { FinanceExportService } from './finance-export.service';
import { ExportTasksService } from './export-tasks.service';
import { SystemModule } from '../system/system.module';
@Module({
  imports: [SystemModule],
  controllers: [CommissionsController, FinanceController],
  providers: [CommissionsService, FinanceService, FinanceExportService, ExportTasksService],
})
export class FinanceModule {}
