import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/auth-user.type';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../authorization/roles.decorator';
import { RolesGuard } from '../authorization/roles.guard';
import { HideLogDto } from './dto/hide-log.dto';
import { RestoreBackupDto } from './dto/restore-backup.dto';
import { UpdateSettingsDto } from './dto/update-settings.dto';
import { SystemService } from './system.service';

@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
export class SystemController {
  constructor(private readonly system: SystemService) {}
  @Get('settings') @Roles(UserRole.SUPER_ADMIN) async settings() {
    return {
      code: 200,
      message: 'success',
      data: await this.system.settings(),
    };
  }
  @Put('settings') @Roles(UserRole.SUPER_ADMIN) async updateSettings(
    @Body() dto: UpdateSettingsDto,
    @CurrentUser() user: AuthUser,
  ) {
    return {
      code: 200,
      message: 'success',
      data: await this.system.updateSettings(dto, user),
    };
  }
  @Get('operation-logs')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  async operations(
    @Query() query: Record<string, string>,
    @CurrentUser() user: AuthUser,
  ) {
    return {
      code: 200,
      message: 'success',
      data: await this.system.listOperations(query, user),
    };
  }
  @Post('operation-logs/:id/hide') @Roles(UserRole.SUPER_ADMIN) async hide(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: RestoreBackupDto,
    @CurrentUser() user: AuthUser,
  ) {
    await this.system.hideOperation(id, dto.reason, user);
    return { code: 200, message: 'success', data: null };
  }
  @Post('operation-logs/:id/restore')
  @Roles(UserRole.SUPER_ADMIN)
  async restore(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: HideLogDto,
    @CurrentUser() user: AuthUser,
  ) {
    await this.system.hideOperation(id, dto.reason, user, true);
    return { code: 200, message: 'success', data: null };
  }
  @Get('security-audits') @Roles(UserRole.SUPER_ADMIN) async audits() {
    return {
      code: 200,
      message: 'success',
      data: await this.system.listAudits(),
    };
  }
  @Get('security-audits/verify')
  @Roles(UserRole.SUPER_ADMIN)
  async verifyAudits() {
    return {
      code: 200,
      message: 'success',
      data: await this.system.verifyAudits(),
    };
  }
  @Get('backups') @Roles(UserRole.SUPER_ADMIN) async backups() {
    return {
      code: 200,
      message: 'success',
      data: await this.system.listBackups(),
    };
  }
  @Post('backups') @Roles(UserRole.SUPER_ADMIN) async backup(
    @CurrentUser() user: AuthUser,
  ) {
    return {
      code: 200,
      message: 'success',
      data: await this.system.createBackup(user),
    };
  }
  @Post('backups/:id/restore') @Roles(UserRole.SUPER_ADMIN) async restoreBackup(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: RestoreBackupDto,
    @CurrentUser() user: AuthUser,
  ) {
    return {
      code: 200,
      message: 'success',
      data: await this.system.restoreBackup(
        id,
        dto.reason,
        dto.confirmation,
        user,
      ),
    };
  }
}
