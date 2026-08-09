import { Module } from '@nestjs/common';
import { RentBillsController } from './rent-bills.controller';
import { RentBillsService } from './rent-bills.service';

@Module({ controllers: [RentBillsController], providers: [RentBillsService] })
export class RentBillsModule {}
