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
import { RejectVoidRequestDto } from './dto/reject-void-request.dto';
import { SubmitVoidRequestDto } from './dto/submit-void-request.dto';
import { VoidRequestsService } from './void-requests.service';
@Controller('payment-void-requests')
@UseGuards(JwtAuthGuard, RolesGuard)
export class VoidRequestsController {
  constructor(private readonly requests: VoidRequestsService) {}
  @Get() async list(@Query('paymentId') paymentId?: string) {
    return {
      code: 200,
      message: 'success',
      data: await this.requests.list(paymentId ? Number(paymentId) : undefined),
    };
  }
  @Post()
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  async submit(
    @Body() dto: SubmitVoidRequestDto,
    @CurrentUser() user: AuthUser,
  ) {
    return {
      code: 200,
      message: 'success',
      data: await this.requests.submit(dto, user),
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
      data: await this.requests.approve(id, user),
    };
  }
  @Post(':id/reject')
  @Roles(UserRole.SUPER_ADMIN)
  async reject(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: RejectVoidRequestDto,
    @CurrentUser() user: AuthUser,
  ) {
    return {
      code: 200,
      message: 'success',
      data: await this.requests.reject(id, dto.reason, user),
    };
  }
}
