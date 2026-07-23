import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/auth-user.type';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../authorization/roles.decorator';
import { RolesGuard } from '../authorization/roles.guard';
import { RecordPaymentDto } from './dto/record-payment.dto';
import { PaymentsService } from './payments.service';

@Controller('payments')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}
  @Get()
  async list(@Query('contractId') contractId?: string) {
    return {
      code: 200,
      message: 'success',
      data: await this.payments.list(
        contractId ? Number(contractId) : undefined,
      ),
    };
  }
  @Get('prepayments')
  async prepayments(@Query('contractId') contractId?: string) {
    if (
      !contractId ||
      !Number.isInteger(Number(contractId)) ||
      Number(contractId) < 1
    )
      return { code: 400, message: 'contractId 必填', data: null };
    return {
      code: 200,
      message: 'success',
      data: await this.payments.prepayments(Number(contractId)),
    };
  }
  @Post()
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  async record(@Body() dto: RecordPaymentDto, @CurrentUser() user: AuthUser) {
    return {
      code: 200,
      message: 'success',
      data: await this.payments.record(dto, user),
    };
  }
}
