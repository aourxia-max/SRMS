import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/auth-user.type';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../authorization/roles.decorator';
import { RolesGuard } from '../authorization/roles.guard';
import { CommissionsService } from './commissions.service';
import { CreateCommissionDto, UpdateCommissionDto } from './dto/commission.dto';
@Controller('commissions')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN)
export class CommissionsController {
  constructor(private readonly commissions: CommissionsService) {}
  @Get() async list() {
    return {
      code: 200,
      message: 'success',
      data: await this.commissions.list(),
    };
  }
  @Post() async create(
    @Body() dto: CreateCommissionDto,
    @CurrentUser() user: AuthUser,
  ) {
    return {
      code: 200,
      message: 'success',
      data: await this.commissions.create(dto, user),
    };
  }
  @Patch(':id') async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateCommissionDto,
    @CurrentUser() user: AuthUser,
  ) {
    return {
      code: 200,
      message: 'success',
      data: await this.commissions.update(id, dto, user),
    };
  }
  @Delete(':id') async remove(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: AuthUser,
  ) {
    return {
      code: 200,
      message: 'success',
      data: await this.commissions.remove(id, user),
    };
  }
}
