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
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/auth-user.type';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../authorization/roles.decorator';
import { RolesGuard } from '../authorization/roles.guard';
import { SubmitDepositRefundDto } from './dto/submit-deposit-refund.dto';
import { DepositRefundsService } from './deposit-refunds.service';
import { FilesService } from '../files/files.service';
import type { UploadedFile as StoredFile } from '../files/files.service';
@Controller('deposit-refunds')
@UseGuards(JwtAuthGuard, RolesGuard)
export class DepositRefundsController {
  constructor(
    private readonly refunds: DepositRefundsService,
    private readonly files: FilesService,
  ) {}
  @Get() async list(@Query('contractId') contractId?: string) {
    return {
      code: 200,
      message: 'success',
      data: await this.refunds.list(
        contractId ? Number(contractId) : undefined,
      ),
    };
  }
  @Post()
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  async submit(
    @Body() dto: SubmitDepositRefundDto,
    @CurrentUser() user: AuthUser,
  ) {
    return {
      code: 200,
      message: 'success',
      data: await this.refunds.submit(dto, user),
    };
  }
  @Post('proof-files')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @UseInterceptors(FileInterceptor('file'))
  async upload(
    @UploadedFile() file: StoredFile,
    @CurrentUser() user: AuthUser,
  ) {
    return {
      code: 200,
      message: 'success',
      data: await this.files.saveDepositRefundProof(file, user),
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
}
