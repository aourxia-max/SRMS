import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/auth-user.type';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../authorization/roles.decorator';
import { RolesGuard } from '../authorization/roles.guard';
import { CheckoutService } from './checkout.service';
import { InitiateCheckoutDto } from './dto/initiate-checkout.dto';
import { SubmitCheckoutSettlementDto } from './dto/submit-checkout-settlement.dto';
import { RejectCheckoutSettlementDto } from './dto/reject-checkout-settlement.dto';

@Controller('checkout-settlements')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CheckoutController {
  constructor(private readonly checkout: CheckoutService) {}
  @Get() async list() {
    return { code: 200, message: 'success', data: await this.checkout.list() };
  }
  @Post('contract/:contractId/initiate')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  async initiate(
    @Param('contractId', ParseIntPipe) contractId: number,
    @Body() dto: InitiateCheckoutDto,
    @CurrentUser() user: AuthUser,
  ) {
    return {
      code: 200,
      message: 'success',
      data: await this.checkout.initiate(contractId, dto, user),
    };
  }
  @Post(':id/submit')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  async submit(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SubmitCheckoutSettlementDto,
    @CurrentUser() user: AuthUser,
  ) {
    return {
      code: 200,
      message: 'success',
      data: await this.checkout.submit(id, dto, user),
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
      data: await this.checkout.approve(id, user),
    };
  }
  @Post(':id/reject')
  @Roles(UserRole.SUPER_ADMIN)
  async reject(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: RejectCheckoutSettlementDto,
    @CurrentUser() user: AuthUser,
  ) {
    return {
      code: 200,
      message: 'success',
      data: await this.checkout.reject(id, dto.reason, user),
    };
  }
}
