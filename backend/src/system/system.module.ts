import { Module } from '@nestjs/common';
import { SystemController } from './system.controller';
import { SystemDefaultsController } from './system-defaults.controller';
import { SystemService } from './system.service';
import { SecurityAuditChainService } from './security-audit-chain.service';

@Module({
  controllers: [SystemController, SystemDefaultsController],
  providers: [SecurityAuditChainService, SystemService],
  exports: [SecurityAuditChainService, SystemService],
})
export class SystemModule {}
