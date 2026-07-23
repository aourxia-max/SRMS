import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { UserRole } from '@prisma/client';
import type { AuthUser } from '../auth/auth-user.type';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../authorization/roles.decorator';
import { RolesGuard } from '../authorization/roles.guard';
import { FilesService } from '../files/files.service';
import type { UploadedFile as StoredFile } from '../files/files.service';
import { RejectPricingRebateDto } from './dto/reject-pricing-rebate.dto';
import { SubmitPricingRebateDto } from './dto/submit-pricing-rebate.dto';
import { PricingRebatesService } from './pricing-rebates.service';

@Controller('pricing-rebates')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PricingRebatesController {
  constructor(
    private readonly rebates: PricingRebatesService,
    private readonly files: FilesService,
  ) {}
  @Get() async list(@Query('contractId') contractId?: string) {
    return {
      code: 200,
      message: 'success',
      data: await this.rebates.list(
        contractId ? Number(contractId) : undefined,
      ),
    };
  }
  @Get('preview/:contractId') async preview(
    @Param('contractId', ParseIntPipe) contractId: number,
  ) {
    return {
      code: 200,
      message: 'success',
      data: await this.rebates.preview(contractId),
    };
  }
  @Post()
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  async submit(
    @Body() dto: SubmitPricingRebateDto,
    @CurrentUser() user: AuthUser,
  ) {
    return {
      code: 200,
      message: 'success',
      data: await this.rebates.submit(dto, user),
    };
  }
  @Post('proof-files')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @UseInterceptors(FileInterceptor('file'))
  async uploadProof(
    @UploadedFile() file: StoredFile,
    @CurrentUser() user: AuthUser,
  ) {
    return {
      code: 200,
      message: 'success',
      data: await this.files.savePricingRebateProof(file, user),
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
      data: await this.rebates.approve(id, user),
    };
  }
  @Post(':id/reject')
  @Roles(UserRole.SUPER_ADMIN)
  async reject(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: RejectPricingRebateDto,
    @CurrentUser() user: AuthUser,
  ) {
    return {
      code: 200,
      message: 'success',
      data: await this.rebates.reject(id, dto.reason, user),
    };
  }
}
