import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Logger,
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
import type { AuthUser } from '../auth/auth-user.type';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../authorization/roles.decorator';
import { RolesGuard } from '../authorization/roles.guard';
import {
  FilesService,
  type UploadedFile as PropertyAffairUploadedFile,
} from '../files/files.service';
import { AppendPropertyAffairProgressDto } from './dto/append-property-affair-progress.dto';
import { CreatePropertyAffairDto } from './dto/create-property-affair.dto';
import { ListPropertyAffairsQueryDto } from './dto/list-property-affairs-query.dto';
import { PropertyAffairVersionDto } from './dto/property-affair-version.dto';
import { UpdatePropertyAffairDto } from './dto/update-property-affair.dto';
import { PropertyAffairsService } from './property-affairs.service';

const previewableMimeTypes = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
]);

@Controller('property-affairs')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
export class PropertyAffairsController {
  private readonly logger = new Logger(PropertyAffairsController.name);

  constructor(
    private readonly propertyAffairs: PropertyAffairsService,
    private readonly files: FilesService,
  ) {}

  @Get()
  async list(@Query() query: ListPropertyAffairsQueryDto) {
    return this.success(await this.propertyAffairs.list(query));
  }

  @Get('categories')
  async categories() {
    return this.success(await this.propertyAffairs.categories());
  }

  @Get('responsible-users')
  async responsibleUsers() {
    return this.success(await this.propertyAffairs.responsibleUsers());
  }

  @Get('recycle-bin')
  async recycleBin(@Query() query: ListPropertyAffairsQueryDto) {
    return this.success(await this.propertyAffairs.listRecycleBin(query));
  }

  @Get(':id')
  async get(@Param('id', ParseIntPipe) id: number) {
    return this.success(await this.propertyAffairs.get(id));
  }

  @Post()
  async create(
    @Body() dto: CreatePropertyAffairDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.success(await this.propertyAffairs.create(dto, user));
  }

  @Patch(':id')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdatePropertyAffairDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.success(await this.propertyAffairs.update(id, dto, user));
  }

  @Post(':id/progress')
  async appendProgress(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AppendPropertyAffairProgressDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.success(
      await this.propertyAffairs.appendProgress(id, dto, user),
    );
  }

  @Delete(':id')
  async softDelete(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: PropertyAffairVersionDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.success(
      await this.propertyAffairs.softDelete(id, dto.version, user),
    );
  }

  @Post(':id/restore')
  async restore(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: PropertyAffairVersionDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.success(
      await this.propertyAffairs.restore(id, dto.version, user),
    );
  }

  @Delete(':id/permanent')
  @Roles(UserRole.SUPER_ADMIN)
  async permanentDelete(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: PropertyAffairVersionDto,
    @CurrentUser() user: AuthUser,
  ) {
    const releasedFileIds = await this.propertyAffairs.permanentDelete(
      id,
      dto.version,
      user,
    );
    try {
      await this.files.cleanupReleasedPropertyAffairFiles(releasedFileIds);
    } catch {
      this.logger.error('物业办事附件清理失败，需要稍后重试');
    }
    return this.success({ id });
  }

  @Post(':id/files')
  @UseInterceptors(FileInterceptor('file'))
  async upload(
    @Param('id', ParseIntPipe) id: number,
    @UploadedFile() file: PropertyAffairUploadedFile,
    @CurrentUser() user: AuthUser,
  ) {
    return this.success(
      await this.files.saveAndLinkPropertyAffairFile(id, file, user),
    );
  }

  @Get(':id/files/:fileId/preview')
  async preview(
    @Param('id', ParseIntPipe) id: number,
    @Param('fileId', ParseIntPipe) fileId: number,
    @Res() response: Response,
  ) {
    const { asset, content } = await this.files.readPropertyAffairFile(
      id,
      fileId,
    );
    if (!previewableMimeTypes.has(asset.mimeType)) {
      throw new BadRequestException('该附件不支持在线预览，请下载后查看');
    }
    this.sendFile(response, asset.mimeType, asset.originalName, content, true);
  }

  @Get(':id/files/:fileId/download')
  async download(
    @Param('id', ParseIntPipe) id: number,
    @Param('fileId', ParseIntPipe) fileId: number,
    @Res() response: Response,
  ) {
    const { asset, content } = await this.files.readPropertyAffairFile(
      id,
      fileId,
    );
    this.sendFile(response, asset.mimeType, asset.originalName, content, false);
  }

  @Delete(':id/files/:fileId')
  async unlink(
    @Param('id', ParseIntPipe) id: number,
    @Param('fileId', ParseIntPipe) fileId: number,
    @CurrentUser() user: AuthUser,
  ) {
    return this.success(
      await this.files.unlinkPropertyAffairFile(id, fileId, user),
    );
  }

  private success(data: unknown) {
    return { code: 200, message: 'success', data };
  }

  private sendFile(
    response: Response,
    mimeType: string,
    originalName: string,
    content: Buffer,
    inline: boolean,
  ) {
    response.setHeader('Content-Type', mimeType);
    response.setHeader(
      'Content-Disposition',
      `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(originalName)}`,
    );
    response.send(content);
  }
}
