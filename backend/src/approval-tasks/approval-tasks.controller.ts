import { Controller, Get, UseGuards } from '@nestjs/common';
import type { AuthUser } from '../auth/auth-user.type';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ApprovalTasksService } from './approval-tasks.service';

@Controller('approval-tasks')
@UseGuards(JwtAuthGuard)
export class ApprovalTasksController {
  constructor(private readonly approvalTasks: ApprovalTasksService) {}

  @Get('counts')
  async counts(@CurrentUser() user: AuthUser) {
    return {
      code: 200,
      message: 'success',
      data: await this.approvalTasks.counts(user),
    };
  }
}
