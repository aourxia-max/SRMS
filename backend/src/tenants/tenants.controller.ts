import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
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
import type { UploadedFile as TenantUploadedFile } from '../files/files.service';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { ListTenantsDto } from './dto/list-tenants.dto';
import { UpdateTenantDto } from './dto/update-tenant.dto';
import { TenantsService } from './tenants.service';

@Controller('tenants')
@UseGuards(JwtAuthGuard)
export class TenantsController {
  constructor(
    private readonly tenants: TenantsService,
    private readonly files: FilesService,
  ) {}
  @Get() async list(@Query() query: ListTenantsDto) {
    return {
      code: 200,
      message: 'success',
      data: await this.tenants.list(query),
    };
  }
  @Get(':id') async get(@Param('id', ParseIntPipe) id: number) {
    return { code: 200, message: 'success', data: await this.tenants.get(id) };
  }
  @Post()
  @UseGuards(RolesGuard)
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  async create(@Body() dto: CreateTenantDto) {
    return {
      code: 200,
      message: 'success',
      data: await this.tenants.create(dto),
    };
  }
  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateTenantDto,
  ) {
    return {
      code: 200,
      message: 'success',
      data: await this.tenants.update(id, dto),
    };
  }
  @Get(':id/sensitive')
  @UseGuards(RolesGuard)
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  async sensitive(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: AuthUser,
  ) {
    return {
      code: 200,
      message: 'success',
      data: await this.tenants.sensitive(id, user),
    };
  }
  @Get(':id/files') async listFiles(@Param('id', ParseIntPipe) id: number) {
    return {
      code: 200,
      message: 'success',
      data: await this.files.listTenantFiles(id),
    };
  }
  @Post(':id/files')
  @UseGuards(RolesGuard)
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @UseInterceptors(FileInterceptor('file'))
  async upload(
    @Param('id', ParseIntPipe) id: number,
    @UploadedFile() file: TenantUploadedFile,
    @CurrentUser() user: AuthUser,
  ) {
    await this.tenants.get(id);
    return {
      code: 200,
      message: 'success',
      data: await this.files.saveTenantId(id, file, user),
    };
  }
  @Get(':id/files/:fileId/download')
  async download(
    @Param('id', ParseIntPipe) id: number,
    @Param('fileId', ParseIntPipe) fileId: number,
    @Res() response: Response,
  ) {
    const { asset, content } = await this.files.downloadTenantFile(id, fileId);
    response.setHeader('Content-Type', asset.mimeType);
    response.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(asset.originalName)}`,
    );
    response.send(content);
  }
}
