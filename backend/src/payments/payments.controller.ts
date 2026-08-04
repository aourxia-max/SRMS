import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { UserRole } from '@prisma/client';
import type { Response } from 'express';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/auth-user.type';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../authorization/roles.decorator';
import { RolesGuard } from '../authorization/roles.guard';
import { FilesService } from '../files/files.service';
import type { UploadedFile as StoredFile } from '../files/files.service';
import { RecordPaymentDto } from './dto/record-payment.dto';
import { PaymentsService } from './payments.service';

@Controller('payments')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PaymentsController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly files: FilesService,
  ) {}
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
      data: await this.files.savePaymentProof(file, user),
    };
  }

  @Get(':paymentId/files/:fileId')
  async downloadProof(
    @Param('paymentId', ParseIntPipe) paymentId: number,
    @Param('fileId', ParseIntPipe) fileId: number,
    @Res() response: Response,
  ) {
    const { asset, content } = await this.files.downloadPaymentProof(
      paymentId,
      fileId,
    );
    response.setHeader('Content-Type', asset.mimeType);
    response.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(asset.originalName)}`,
    );
    response.send(content);
  }
}
