import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../prisma/prisma.module';
import { TieredContractCleanupService } from './tiered-contract-cleanup.service';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), PrismaModule],
  providers: [TieredContractCleanupService],
  exports: [TieredContractCleanupService],
})
export class MaintenanceModule {}
