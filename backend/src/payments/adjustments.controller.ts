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
import { RejectAdjustmentDto } from './dto/reject-adjustment.dto';
import { SubmitAdjustmentDto } from './dto/submit-adjustment.dto';
import { AdjustmentsService } from './adjustments.service';

@Controller('bill-adjustments')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AdjustmentsController {
  constructor(private readonly adjustments: AdjustmentsService) {}
  @Get()
  async list(@Query('rentBillId') rentBillId?: string) {
    return {
      code: 200,
      message: 'success',
      data: await this.adjustments.list(
        rentBillId ? Number(rentBillId) : undefined,
      ),
    };
  }
  @Post()
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  async submit(
    @Body() dto: SubmitAdjustmentDto,
    @CurrentUser() user: AuthUser,
  ) {
    return {
      code: 200,
      message: 'success',
      data: await this.adjustments.submit(dto, user),
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
      data: await this.adjustments.approve(id, user),
    };
  }
  @Post(':id/reject')
  @Roles(UserRole.SUPER_ADMIN)
  async reject(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: RejectAdjustmentDto,
    @CurrentUser() user: AuthUser,
  ) {
    return {
      code: 200,
      message: 'success',
      data: await this.adjustments.reject(id, dto.reason, user),
    };
  }
}
