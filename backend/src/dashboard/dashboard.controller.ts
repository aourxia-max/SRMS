import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/auth-user.type';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { DashboardService } from './dashboard.service';
@Controller('dashboard')
@UseGuards(JwtAuthGuard)
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}
  @Get() async summary(
    @CurrentUser() user: AuthUser,
    @Query('buildingId') buildingId?: string,
    @Query('statuses') statuses?: string,
  ) {
    const data = await this.dashboard.summary(
      user,
      buildingId ? Number(buildingId) : undefined,
      statuses?.split(',').filter(Boolean),
    );
    return {
      code: 200,
      message: 'success',
      data,
    };
  }
}
