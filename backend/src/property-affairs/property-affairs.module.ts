import { Module } from '@nestjs/common';
import { FilesModule } from '../files/files.module';
import { SystemModule } from '../system/system.module';
import { PropertyAffairsController } from './property-affairs.controller';
import { PropertyAffairsService } from './property-affairs.service';

@Module({
  imports: [FilesModule, SystemModule],
  controllers: [PropertyAffairsController],
  providers: [PropertyAffairsService],
  exports: [PropertyAffairsService],
})
export class PropertyAffairsModule {}
