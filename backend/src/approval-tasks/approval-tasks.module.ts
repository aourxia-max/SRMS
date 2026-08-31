import { Module } from '@nestjs/common';
import { ApprovalTasksController } from './approval-tasks.controller';
import { ApprovalTasksService } from './approval-tasks.service';

@Module({
  controllers: [ApprovalTasksController],
  providers: [ApprovalTasksService],
})
export class ApprovalTasksModule {}
