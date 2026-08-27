import {
  ArgumentsHost,
  Body,
  Catch,
  Controller,
  Delete,
  ExceptionFilter,
  Get,
  HttpException,
  Param,
  PipeTransform,
  Post,
  Query,
  Res,
  UploadedFile,
  UseFilters,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import type { Response } from 'express';
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
  ApproveContractVoidRequestDto,
  ListContractVoidRequestsDto,
  RejectContractVoidRequestDto,
  SubmitContractVoidRequestDto,
} from './dto/contract-void.dto';

const contractVoidUploadBufferLimit = 100 * 1024 * 1024;

class ContractVoidPositiveIntPipe implements PipeTransform<string, number> {
  transform(value: string) {
    if (!/^[1-9]\d*$/.test(value))
      throw new HttpException('编号必须为正整数', 400);
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed))
      throw new HttpException('编号必须为正整数', 400);
    return parsed;
  }
}

const positiveIntPipe = new ContractVoidPositiveIntPipe();

@Catch(HttpException)
class ContractVoidHttpExceptionFilter implements ExceptionFilter {
  catch(exception: HttpException, host: ArgumentsHost) {
    const status = exception.getStatus();
    const response = exception.getResponse();
    const rawMessage =
      typeof response === 'string'
        ? response
        : (response as { message?: string | string[] }).message;
    const messages = Array.isArray(rawMessage)
      ? rawMessage
      : [rawMessage ?? exception.message];
    const message = messages.map((item) => this.toChinese(item)).join('；');
    const httpResponse = host.switchToHttp().getResponse<Response>();
    httpResponse.status(status).json({
      code: status,
      message,
      data: null,
    });
  }

  private toChinese(message: string) {
    const unknownProperty = /^property (.+) should not exist$/.exec(message);
    if (unknownProperty) return `不允许提交字段：${unknownProperty[1]}`;
    return /[\u4e00-\u9fff]/.test(message) ? message : '请求参数无效';
  }
}

@Controller('contracts')
@UseGuards(JwtAuthGuard, RolesGuard)
@UseFilters(ContractVoidHttpExceptionFilter)
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
    @Param('id', positiveIntPipe) id: number,
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
    @Param('id', positiveIntPipe) id: number,
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

  @Post('void-requests/:id/refresh-snapshot')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  async refreshSnapshot(
    @Param('id', positiveIntPipe) id: number,
    @CurrentUser() user: AuthUser,
  ) {
    return {
      code: 200,
      message: 'success',
      data: await this.requests.refreshSnapshot(id, user),
    };
  }

  @Post('void-requests/:id/approve')
  @Roles(UserRole.SUPER_ADMIN)
  async approve(
    @Param('id', positiveIntPipe) id: number,
    @Body() dto: ApproveContractVoidRequestDto,
    @CurrentUser() user: AuthUser,
  ) {
    return {
      code: 200,
      message: 'success',
      data: await this.requests.approve(id, dto, user),
    };
  }

  @Post('void-requests/:id/cancel')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  async cancel(
    @Param('id', positiveIntPipe) id: number,
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
    @Param('id', positiveIntPipe) id: number,
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

  @Delete('void-request-files/:fileId')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  async deleteFile(
    @Param('fileId', positiveIntPipe) fileId: number,
    @CurrentUser() user: AuthUser,
  ) {
    return {
      code: 200,
      message: 'success',
      data: await this.files.deleteContractVoidProof(fileId, user),
    };
  }
  @Get('void-requests/:id/files/:fileId/download')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  async downloadFile(
    @Param('id', positiveIntPipe) id: number,
    @Param('fileId', positiveIntPipe) fileId: number,
    @CurrentUser() user: AuthUser,
    @Res() response: Response,
  ) {
    const { asset, content } = await this.files.downloadContractVoidProof(
      id,
      fileId,
      user,
    );
    response.setHeader('Content-Type', asset.mimeType);
    response.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(asset.originalName)}`,
    );
    response.send(content);
  }
}
