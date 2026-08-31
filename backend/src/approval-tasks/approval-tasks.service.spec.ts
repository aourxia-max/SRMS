import { UserRole } from '@prisma/client';
import type { AuthUser } from '../auth/auth-user.type';
import type { PrismaService } from '../prisma/prisma.service';
import { emptyApprovalTaskCounts } from './approval-task-counts';
import { ApprovalTasksService } from './approval-tasks.service';

const admin: AuthUser = {
  id: 2,
  username: 'admin',
  displayName: '管理员',
  role: UserRole.ADMIN,
};

const visitor: AuthUser = {
  id: 3,
  username: 'visitor',
  displayName: '访客',
  role: UserRole.VISITOR,
};

describe('ApprovalTasksService', () => {
  function setup() {
    const countMocks = {
      contractChange: jest.fn().mockResolvedValue(2),
      pricingRebate: jest.fn().mockResolvedValue(3),
      contractVoidRequest: jest.fn().mockResolvedValue(4),
      billAdjustment: jest.fn().mockResolvedValue(5),
      paymentRefund: jest.fn().mockResolvedValue(6),
      paymentVoidRequest: jest.fn().mockResolvedValue(7),
      checkoutSettlement: jest.fn().mockResolvedValue(8),
      depositRefund: jest.fn().mockResolvedValue(9),
    };
    const db = Object.fromEntries(
      Object.entries(countMocks).map(([name, count]) => [name, { count }]),
    );
    const service = new ApprovalTasksService({ db } as unknown as PrismaService);
    return { service, countMocks };
  }

  it('按数据库待审批状态返回八类数量和三个模块合计', async () => {
    const { service, countMocks } = setup();

    await expect(service.counts(admin)).resolves.toEqual({
      contractChanges: 2,
      fixedRentRebates: 3,
      contractVoidRequests: 4,
      billAdjustments: 5,
      paymentRefunds: 6,
      paymentVoidRequests: 7,
      checkoutSettlements: 8,
      depositRefunds: 9,
      contractsTotal: 9,
      paymentsTotal: 18,
      checkoutsTotal: 17,
      total: 44,
    });

    expect(countMocks.contractChange).toHaveBeenCalledWith({
      where: { approvalStatus: 'PENDING' },
    });
    expect(countMocks.pricingRebate).toHaveBeenCalledWith({
      where: { approvalStatus: 'PENDING' },
    });
    expect(countMocks.contractVoidRequest).toHaveBeenCalledWith({
      where: { status: 'PENDING' },
    });
    expect(countMocks.billAdjustment).toHaveBeenCalledWith({
      where: { approvalStatus: 'PENDING' },
    });
    expect(countMocks.paymentRefund).toHaveBeenCalledWith({
      where: { approvalStatus: 'PENDING' },
    });
    expect(countMocks.paymentVoidRequest).toHaveBeenCalledWith({
      where: { approvalStatus: 'PENDING' },
    });
    expect(countMocks.checkoutSettlement).toHaveBeenCalledWith({
      where: { status: 'PENDING' },
    });
    expect(countMocks.depositRefund).toHaveBeenCalledWith({
      where: { approvalStatus: 'PENDING' },
    });
  });

  it('访客只获得零值且不会查询审批业务表', async () => {
    const { service, countMocks } = setup();

    await expect(service.counts(visitor)).resolves.toEqual(
      emptyApprovalTaskCounts(),
    );
    for (const count of Object.values(countMocks)) {
      expect(count).not.toHaveBeenCalled();
    }
  });
});
