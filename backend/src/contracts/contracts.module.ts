import { Module } from '@nestjs/common';
import { ContractsController } from './contracts.controller';
import { ContractsService } from './contracts.service';
import { ContractLifecycleService } from './contract-lifecycle.service';
import { ContractDraftsService } from './contract-drafts.service';

@Module({
  controllers: [ContractsController],
  providers: [
    ContractsService,
    ContractLifecycleService,
    ContractDraftsService,
  ],
})
export class ContractsModule {}
