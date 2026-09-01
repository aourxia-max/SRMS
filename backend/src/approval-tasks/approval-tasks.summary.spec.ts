import { UserRole } from '@prisma/client';
import type { AuthUser } from '../auth/auth-user.type';
import type { PrismaService } from '../prisma/prisma.service';
import { emptyApprovalTaskCounts } from './approval-task-counts';
import { ApprovalTasksService } from './approval-tasks.service';

const superAdmin: AuthUser = {
  id: 1,
  username: 'root',
  displayName: '超级管理员',
  role: UserRole.SUPER_ADMIN,
};

const admin: AuthUser = {
  id: 2,
  username: 'admin',
  displayName: '管理员',
  role: UserRole.ADMIN,
};

describe('ApprovalTasksService summary', () => {
  function setup() {
    const contract = {
      id: 101,
      contractNo: 'HT202609010001 | 1栋101 | 张三',
      room: { id: 11, fullHouseNo: '1栋101' },
    };
    const findManyMocks = {
      contractChange: jest.fn().mockResolvedValue([
        {
          id: 1,
          changeNo: 'BG001',
          submittedAt: new Date('2026-09-01T01:00:00Z'),
          contract,
        },
      ]),
      pricingRebate: jest.fn().mockResolvedValue([
        {
          id: 2,
          rebateNo: 'TC002',
          submittedAt: new Date('2026-09-01T02:00:00Z'),
          contract,
        },
      ]),
      contractVoidRequest: jest.fn().mockResolvedValue([
        {
          id: 3,
          requestNo: 'HTZF003',
          submittedAt: new Date('2026-09-01T03:00:00Z'),
          contract,
        },
      ]),
      billAdjustment: jest.fn().mockResolvedValue([
        {
          id: 4,
          adjustmentNo: 'TZ004',
          submittedAt: new Date('2026-09-01T04:00:00Z'),
          rentBill: { contract },
        },
      ]),
      paymentRefund: jest.fn().mockResolvedValue([
        {
          id: 5,
          refundNo: 'TK005',
          submittedAt: new Date('2026-09-01T05:00:00Z'),
          contract,
        },
      ]),
      paymentVoidRequest: jest.fn().mockResolvedValue([
        {
          id: 6,
          requestNo: 'ZF006',
          submittedAt: new Date('2026-09-01T06:00:00Z'),
          payment: { contract },
        },
      ]),
      checkoutSettlement: jest.fn().mockResolvedValue([
        {
          id: 7,
          settlementNo: 'TZ007',
          submittedAt: new Date('2026-09-01T07:00:00Z'),
          contract,
        },
      ]),
      depositRefund: jest.fn().mockResolvedValue([
        {
          id: 8,
          refundNo: 'YJTK008',
          submittedAt: new Date('2026-09-01T08:00:00Z'),
          contract,
        },
      ]),
    };
    const db = Object.fromEntries(
      Object.entries(findManyMocks).map(([name, findMany]) => [
        name,
        { findMany },
      ]),
    );
    const service = new ApprovalTasksService({
      db,
    } as unknown as PrismaService);
    return { service, findManyMocks };
  }

  it('为超级管理员返回八类统一数量和按提交时间倒序的待审批事项', async () => {
    const { service, findManyMocks } = setup();

    const result = await service.summary(superAdmin);

    expect(result.counts).toEqual({
      contractChanges: 1,
      fixedRentRebates: 1,
      contractVoidRequests: 1,
      billAdjustments: 1,
      paymentRefunds: 1,
      paymentVoidRequests: 1,
      checkoutSettlements: 1,
      depositRefunds: 1,
      contractsTotal: 3,
      paymentsTotal: 3,
      checkoutsTotal: 2,
      total: 8,
    });
    expect(result.items.map((item) => item.type)).toEqual([
      'DEPOSIT_REFUND',
      'CHECKOUT_SETTLEMENT',
      'PAYMENT_VOID_REQUEST',
      'PAYMENT_REFUND',
      'BILL_ADJUSTMENT',
      'CONTRACT_VOID_REQUEST',
      'PRICING_REBATE',
      'CONTRACT_CHANGE',
    ]);
    expect(result.items[7]).toMatchObject({
      id: 1,
      type: 'CONTRACT_CHANGE',
      label: '合同变更',
      businessNo: 'BG001',
      contractId: 101,
      contractNo: 'HT202609010001 | 1栋101 | 张三',
      roomId: 11,
      fullHouseNo: '1栋101',
    });
    for (const findMany of Object.values(findManyMocks)) {
      expect(findMany).toHaveBeenCalledTimes(1);
    }
  });

  it('普通管理员获得空摘要且不会查询全局审批明细', async () => {
    const { service, findManyMocks } = setup();

    await expect(service.summary(admin)).resolves.toEqual({
      counts: emptyApprovalTaskCounts(),
      items: [],
    });
    for (const findMany of Object.values(findManyMocks)) {
      expect(findMany).not.toHaveBeenCalled();
    }
  });
});
