import { Module } from '@nestjs/common';
import { SystemController } from './system.controller';
import { SystemDefaultsController } from './system-defaults.controller';
import { SystemService } from './system.service';

@Module({
  controllers: [SystemController, SystemDefaultsController],
  providers: [SystemService],
  exports: [SystemService],
})
export class SystemModule {}
