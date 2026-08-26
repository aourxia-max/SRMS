import { Module } from '@nestjs/common';
import { ContractsController } from './contracts.controller';
import { ContractsService } from './contracts.service';
import { ContractLifecycleService } from './contract-lifecycle.service';
import { ContractDraftsService } from './contract-drafts.service';
import { ContractDepositService } from './contract-deposit.service';
import { FilesModule } from '../files/files.module';
import { SystemModule } from '../system/system.module';
import { ContractVoidPreviewService } from './contract-void-preview.service';
import { ContractVoidRequestsService } from './contract-void-requests.service';
import { ContractVoidController } from './contract-void.controller';
import { ContractVoidExecutorService } from './contract-void-executor.service';
import { ContractVoidReversalWriter } from './contract-void-reversal-writer';

@Module({
  imports: [FilesModule, SystemModule],
  controllers: [ContractVoidController, ContractsController],
  providers: [
    ContractVoidRequestsService,
    ContractVoidExecutorService,
    ContractVoidReversalWriter,
    ContractsService,
    ContractLifecycleService,
    ContractDepositService,
    ContractDraftsService,
    ContractVoidPreviewService,
  ],
  exports: [
    ContractLifecycleService,
    ContractVoidPreviewService,
    ContractVoidExecutorService,
  ],
})
export class ContractsModule {}
