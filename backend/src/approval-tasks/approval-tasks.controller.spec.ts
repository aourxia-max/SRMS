import 'reflect-metadata';
import { GUARDS_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { UserRole } from '@prisma/client';
import type { AuthUser } from '../auth/auth-user.type';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { ApprovalTaskCounts } from './approval-task-counts';
import { ApprovalTasksController } from './approval-tasks.controller';

const admin: AuthUser = {
  id: 2,
  username: 'admin',
  displayName: '管理员',
  role: UserRole.ADMIN,
};

const counts: ApprovalTaskCounts = {
  contractChanges: 1,
  fixedRentRebates: 2,
  contractVoidRequests: 3,
  billAdjustments: 4,
  paymentRefunds: 5,
  paymentVoidRequests: 6,
  checkoutSettlements: 7,
  depositRefunds: 8,
  contractsTotal: 6,
  paymentsTotal: 15,
  checkoutsTotal: 15,
  total: 36,
};

describe('ApprovalTasksController', () => {
  it('仅在登录守卫后暴露待审批数量接口', () => {
    expect(Reflect.getMetadata(PATH_METADATA, ApprovalTasksController)).toBe(
      'approval-tasks',
    );
    expect(
      Reflect.getMetadata(GUARDS_METADATA, ApprovalTasksController),
    ).toEqual([JwtAuthGuard]);
    const handler = (
      ApprovalTasksController.prototype as unknown as Record<string, object>
    ).counts;
    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe('counts');
  });

  it('以统一响应结构返回当前用户的数量', async () => {
    const service = { counts: jest.fn().mockResolvedValue(counts) };
    const controller = new ApprovalTasksController(service as never);

    await expect(controller.counts(admin)).resolves.toEqual({
      code: 200,
      message: 'success',
      data: counts,
    });
    expect(service.counts).toHaveBeenCalledWith(admin);
  });
});
