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
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/auth-user.type';
import { Roles } from '../authorization/roles.decorator';
import { RolesGuard } from '../authorization/roles.guard';
import {
  CreateFixedContractDto,
  CreateTieredContractDto,
} from './dto/create-fixed-contract.dto';
import { ContractsService } from './contracts.service';
import { SubmitContractChangeDto } from './dto/submit-contract-change.dto';
import { RejectContractChangeDto } from './dto/reject-contract-change.dto';

@Controller('contracts')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ContractsController {
  constructor(private readonly contracts: ContractsService) {}
  @Post('fixed')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  async createFixed(@Body() dto: CreateFixedContractDto) {
    return {
      code: 200,
      message: 'success',
      data: await this.contracts.createFixedContract({
        ...dto,
        startDate: new Date(dto.startDate),
        endDate: new Date(dto.endDate),
      }),
    };
  }

  @Post('tiered')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  async createTiered(@Body() dto: CreateTieredContractDto) {
    return {
      code: 200,
      message: 'success',
      data: await this.contracts.createTieredContract({
        ...dto,
        startDate: new Date(dto.startDate),
        endDate: new Date(dto.endDate),
      }),
    };
  }

  @Post(':id/changes')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  async submitChange(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SubmitContractChangeDto,
    @CurrentUser() user: AuthUser,
  ) {
    return {
      code: 200,
      message: 'success',
      data: await this.contracts.submitChange(id, dto, user),
    };
  }

  @Post('changes/:id/reject')
  @Roles(UserRole.SUPER_ADMIN)
  async rejectChange(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: RejectContractChangeDto,
    @CurrentUser() user: AuthUser,
  ) {
    return {
      code: 200,
      message: 'success',
      data: await this.contracts.rejectChange(id, dto.reason, user),
    };
  }

  @Post('changes/:id/approve')
  @Roles(UserRole.SUPER_ADMIN)
  async approveChange(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: AuthUser,
  ) {
    return {
      code: 200,
      message: 'success',
      data: await this.contracts.approveChange(id, user),
    };
  }

  @Get(':id/changes')
  async changes(@Param('id', ParseIntPipe) id: number) {
    return {
      code: 200,
      message: 'success',
      data: await this.contracts.changes(id),
    };
  }

  @Get()
  async list() {
    return { code: 200, message: 'success', data: await this.contracts.list() };
  }

  @Get(':id/bills')
  async bills(@Param('id', ParseIntPipe) id: number) {
    return {
      code: 200,
      message: 'success',
      data: await this.contracts.bills(id),
    };
  }

  @Get(':id')
  async detail(@Param('id', ParseIntPipe) id: number) {
    return {
      code: 200,
      message: 'success',
      data: await this.contracts.detail(id),
    };
  }
}
