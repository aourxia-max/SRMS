import { Controller, Get, Param, ParseIntPipe, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../authorization/roles.guard';
import { ListRentBillsDto } from './dto/list-rent-bills.dto';
import { RentBillsService } from './rent-bills.service';

@Controller('rent-bills')
@UseGuards(JwtAuthGuard, RolesGuard)
export class RentBillsController {
  constructor(private readonly rentBills: RentBillsService) {}

  @Get()
  async list(@Query() dto: ListRentBillsDto) {
    return { code: 200, message: 'success', data: await this.rentBills.list(dto) };
  }

  @Get(':id')
  async detail(@Param('id', ParseIntPipe) id: number) {
    return { code: 200, message: 'success', data: await this.rentBills.detail(id) };
  }
}
