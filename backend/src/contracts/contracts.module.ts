import { Module } from '@nestjs/common';
import { ContractsController } from './contracts.controller';
import { ContractsService } from './contracts.service';
import { ContractLifecycleService } from './contract-lifecycle.service';
import { ContractDraftsService } from './contract-drafts.service';
import { ContractDepositService } from './contract-deposit.service';
import { FilesModule } from '../files/files.module';
import { ContractVoidPreviewService } from './contract-void-preview.service';
import { ContractVoidRequestsService } from './contract-void-requests.service';
import { ContractVoidController } from './contract-void.controller';

@Module({
  imports: [FilesModule],
  controllers: [ContractVoidController, ContractsController],
  providers: [
    ContractVoidRequestsService,
    ContractsService,
    ContractLifecycleService,
    ContractDepositService,
    ContractDraftsService,
    ContractVoidPreviewService,
  ],
  exports: [ContractLifecycleService, ContractVoidPreviewService],
})
export class ContractsModule {}
