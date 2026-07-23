import {
  Body,
  Controller,
  Get,
  ParseIntPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/auth-user.type';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../authorization/roles.decorator';
import { RolesGuard } from '../authorization/roles.guard';
import { RecordDepositDto } from './dto/record-deposit.dto';
import { DepositsService } from './deposits.service';

@Controller('deposits')
@UseGuards(JwtAuthGuard, RolesGuard)
export class DepositsController {
  constructor(private readonly deposits: DepositsService) {}
  @Get() async list(@Query('contractId', ParseIntPipe) contractId: number) {
    return {
      code: 200,
      message: 'success',
      data: await this.deposits.list(contractId),
    };
  }
  @Post()
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  async record(@Body() dto: RecordDepositDto, @CurrentUser() user: AuthUser) {
    return {
      code: 200,
      message: 'success',
      data: await this.deposits.record(dto, user),
    };
  }
}
