import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Patch,
  ParseIntPipe,
  Post,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { UserRole } from '@prisma/client';
import type { Response } from 'express';
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
import { SaveContractDraftDto } from './dto/save-contract-draft.dto';
import { ContractDraftsService } from './contract-drafts.service';
import { PreviewFixedContractDto } from './dto/preview-fixed-contract.dto';
import { FilesService } from '../files/files.service';
import type { UploadedFile as ContractUploadedFile } from '../files/files.service';

const DEFAULT_CONTRACT_UPLOAD_LIMIT_BYTES = 10 * 1024 * 1024;
const configuredContractUploadLimit = Number(
  process.env.TENANT_FILE_MAX_SIZE_BYTES,
);
// Multer needs a synchronous cap before ConfigService/database settings are
// available. Respect a stricter environment limit while keeping buffering at
// the deployed 10 MiB safety ceiling; FilesService still applies the dynamic
// system limit after buffering.
const contractUploadBufferLimit =
  Number.isSafeInteger(configuredContractUploadLimit) &&
  configuredContractUploadLimit > 0
    ? Math.min(
        configuredContractUploadLimit,
        DEFAULT_CONTRACT_UPLOAD_LIMIT_BYTES,
      )
    : DEFAULT_CONTRACT_UPLOAD_LIMIT_BYTES;

@Controller('contracts')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ContractsController {
  constructor(
    private readonly contracts: ContractsService,
    private readonly drafts: ContractDraftsService,
    private readonly contractFiles: FilesService,
  ) {}

  @Post('files')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: contractUploadBufferLimit },
    }),
  )
  async uploadFile(
    @UploadedFile() file: ContractUploadedFile,
    @CurrentUser() user: AuthUser,
  ) {
    return {
      code: 200,
      message: 'success',
      data: await this.contractFiles.saveContractFile(file, user),
    };
  }
  @Post('drafts')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  async createDraft(
    @Body() dto: SaveContractDraftDto,
    @CurrentUser() user: AuthUser,
  ) {
    return {
      code: 200,
      message: 'success',
      data: await this.drafts.create(dto, user),
    };
  }

  @Get('drafts/:id')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  async draft(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: AuthUser,
  ) {
    return {
      code: 200,
      message: 'success',
      data: await this.drafts.find(id, user),
    };
  }

  @Patch('drafts/:id')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  async updateDraft(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SaveContractDraftDto,
    @CurrentUser() user: AuthUser,
  ) {
    return {
      code: 200,
      message: 'success',
      data: await this.drafts.update(id, dto, user),
    };
  }

  @Post('fixed')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  async createFixed(
    @Body() dto: CreateFixedContractDto,
    @CurrentUser() user: AuthUser,
  ) {
    if (dto.commission && user.role !== UserRole.SUPER_ADMIN)
      throw new ForbiddenException('只有超级管理员可以填写佣金');
    return {
      code: 200,
      message: 'success',
      data: await this.contracts.createFixedContract(
        {
          ...dto,
          startDate: new Date(dto.startDate),
          endDate: new Date(dto.endDate),
          plannedMoveInDate: dto.plannedMoveInDate
            ? new Date(dto.plannedMoveInDate)
            : undefined,
        },
        user,
      ),
    };
  }

  @Post('fixed/preview')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  previewFixed(@Body() dto: PreviewFixedContractDto) {
    return {
      code: 200,
      message: 'success',
      data: this.contracts.previewFixedContract({
        ...dto,
        startDate: new Date(dto.startDate),
        endDate: new Date(dto.endDate),
      }),
    };
  }

  @Post('drafts/:id/confirm')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  async confirmDraft(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: AuthUser,
  ) {
    return {
      code: 200,
      message: 'success',
      data: await this.contracts.confirmFixedContractDraft(id, user),
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
  async list(@CurrentUser() user: AuthUser) {
    return {
      code: 200,
      message: 'success',
      data: await this.contracts.list(user),
    };
  }

  @Get(':id/bills')
  async bills(@Param('id', ParseIntPipe) id: number) {
    return {
      code: 200,
      message: 'success',
      data: await this.contracts.bills(id),
    };
  }

  @Get(':id/files')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.VISITOR)
  async files(@Param('id', ParseIntPipe) id: number) {
    return {
      code: 200,
      message: 'success',
      data: await this.contractFiles.listContractFiles(id),
    };
  }

  @Get(':id/files/:fileId/download')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.VISITOR)
  async downloadFile(
    @Param('id', ParseIntPipe) id: number,
    @Param('fileId', ParseIntPipe) fileId: number,
    @Res() response: Response,
  ) {
    const { asset, content } = await this.contractFiles.downloadContractFile(
      id,
      fileId,
    );
    response.setHeader('Content-Type', asset.mimeType);
    response.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(asset.originalName)}`,
    );
    response.send(content);
  }

  @Get(':id')
  async detail(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: AuthUser,
  ) {
    return {
      code: 200,
      message: 'success',
      data: await this.contracts.detail(id, user),
    };
  }
}
