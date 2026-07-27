import { Module } from '@nestjs/common';
import { ContractsController } from './contracts.controller';
import { ContractsService } from './contracts.service';
import { ContractLifecycleService } from './contract-lifecycle.service';

@Module({
  controllers: [ContractsController],
  providers: [ContractsService, ContractLifecycleService],
})
export class ContractsModule {}
