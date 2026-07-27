import { Module } from '@nestjs/common';
import { PropertiesController } from './properties.controller';
import { RoomDetailsService } from './room-details.service';

@Module({
  controllers: [PropertiesController],
  providers: [RoomDetailsService],
})
export class PropertiesModule {}
