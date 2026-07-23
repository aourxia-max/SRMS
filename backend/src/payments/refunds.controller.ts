import {
  Body,
  Controller,
  Get,
  Param,
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
import { RejectRefundDto } from './dto/reject-refund.dto';
import { SubmitRefundDto } from './dto/submit-refund.dto';
import { RefundsService } from './refunds.service';

@Controller('payment-refunds')
@UseGuards(JwtAuthGuard, RolesGuard)
export class RefundsController {
  constructor(private readonly refunds: RefundsService) {}
  @Get()
  async list(@Query('paymentId') paymentId?: string) {
    return {
      code: 200,
      message: 'success',
      data: await this.refunds.list(paymentId ? Number(paymentId) : undefined),
    };
  }
  @Post()
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  async submit(@Body() dto: SubmitRefundDto, @CurrentUser() user: AuthUser) {
    return {
      code: 200,
      message: 'success',
      data: await this.refunds.submit(dto, user),
    };
  }
  @Post(':id/approve')
  @Roles(UserRole.SUPER_ADMIN)
  async approve(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: AuthUser,
  ) {
    return {
      code: 200,
      message: 'success',
      data: await this.refunds.approve(id, user),
    };
  }
  @Post(':id/reject')
  @Roles(UserRole.SUPER_ADMIN)
  async reject(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: RejectRefundDto,
    @CurrentUser() user: AuthUser,
  ) {
    return {
      code: 200,
      message: 'success',
      data: await this.refunds.reject(id, dto.reason, user),
    };
  }
}
