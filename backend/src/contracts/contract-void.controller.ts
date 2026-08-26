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
import { ContractVoidPreviewService } from './contract-void-preview.service';
import { ContractVoidRequestsService } from './contract-void-requests.service';
import {
  ListContractVoidRequestsDto,
  RejectContractVoidRequestDto,
  SubmitContractVoidRequestDto,
} from './dto/contract-void.dto';

const contractVoidUploadBufferLimit = 100 * 1024 * 1024;

@Controller('contracts')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ContractVoidController {
  constructor(
    private readonly requests: ContractVoidRequestsService,
    private readonly previews: ContractVoidPreviewService,
    private readonly files: FilesService,
  ) {}

  @Get('void-requests')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  async list(
    @Query() query: ListContractVoidRequestsDto,
    @CurrentUser() user: AuthUser,
  ) {
    return {
      code: 200,
      message: 'success',
      data: await this.requests.list(query, user),
    };
  }

  @Get('void-requests/:id')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  async detail(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: AuthUser,
  ) {
    return {
      code: 200,
      message: 'success',
      data: await this.requests.detail(id, user),
    };
  }

  @Get(':id/void-preview')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  async preview(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: AuthUser,
  ) {
    return {
      code: 200,
      message: 'success',
      data: await this.previews.preview(id, user),
    };
  }

  @Post('void-requests')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  async submit(
    @Body() dto: SubmitContractVoidRequestDto,
    @CurrentUser() user: AuthUser,
  ) {
    return {
      code: 200,
      message: 'success',
      data: await this.requests.submit(dto, user),
    };
  }

  @Post('void-requests/:id/cancel')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  async cancel(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: AuthUser,
  ) {
    return {
      code: 200,
      message: 'success',
      data: await this.requests.cancel(id, user),
    };
  }

  @Post('void-requests/:id/reject')
  @Roles(UserRole.SUPER_ADMIN)
  async reject(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: RejectContractVoidRequestDto,
    @CurrentUser() user: AuthUser,
  ) {
    return {
      code: 200,
      message: 'success',
      data: await this.requests.reject(id, dto.reason, user),
    };
  }

  @Post('void-request-files')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: contractVoidUploadBufferLimit },
    }),
  )
  async uploadFile(
    @UploadedFile() file: StoredFile,
    @CurrentUser() user: AuthUser,
  ) {
    return {
      code: 200,
      message: 'success',
      data: await this.files.saveContractVoidProof(file, user),
    };
  }
}
