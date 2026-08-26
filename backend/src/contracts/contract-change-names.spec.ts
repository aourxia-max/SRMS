import { ContractsService } from './contracts.service';

describe('ContractsService readable change records', () => {
  it('enriches primary tenant ids from snapshots with tenant names', async () => {
    const findManyChanges = jest.fn().mockResolvedValue([
      {
        id: 5,
        changeType: 'PRIMARY_TENANT',
        beforeSnapshot: { members: [{ memberRole: 'PRIMARY', tenantId: 9 }] },
        afterSnapshot: { primaryTenantId: 18 },
      },
    ]);
    const findManyTenants = jest.fn().mockResolvedValue([
      { id: 9, name: '张三01' },
      { id: 18, name: '张三02' },
    ]);
    const service = new ContractsService({
      db: {
        contractChange: { findMany: findManyChanges },
        tenant: { findMany: findManyTenants },
      },
    } as never);

    await expect(service.changes(12)).resolves.toEqual([
      expect.objectContaining({
        id: 5,
        tenantNames: { '9': '张三01', '18': '张三02' },
      }),
    ]);
    expect(findManyTenants).toHaveBeenCalledWith({
      where: { id: { in: [9, 18] } },
      select: { id: true, name: true },
    });
  });

  it('提交变更时只把有效优惠写入变更前快照', async () => {
    const findUniqueOrThrow = jest.fn().mockResolvedValue({
      startDate: new Date('2026-01-01'),
      endDate: new Date('2026-12-31'),
      pricingMode: 'FIXED',
      members: [],
      concessions: [],
    });
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 12 }]),
      contract: { findUniqueOrThrow },
      contractChange: { create: jest.fn() },
    };
    const service = new ContractsService({
      db: {
        $transaction: jest.fn(
          (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
        ),
      },
    } as never);

    await expect(
      service.submitChange(
        12,
        {
          changeType: 'RENT',
          effectiveDate: '2026-02-01',
          afterSnapshot: { monthlyRent: '-1' },
          reason: '验证快照范围',
        },
        { id: 1, role: 'ADMIN', username: 'admin', displayName: '管理员' },
      ),
    ).rejects.toThrow();
    expect(findUniqueOrThrow).toHaveBeenCalledWith({
      where: { id: 12 },
      include: {
        members: { where: { isCurrent: true } },
        concessions: { where: { status: 'ACTIVE' } },
      },
    });
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      findUniqueOrThrow.mock.invocationCallOrder[0],
    );
  });
});
