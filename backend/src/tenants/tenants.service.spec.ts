import { ConflictException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { TenantsService } from './tenants.service';

describe('TenantsService.remove', () => {
  const user = {
    id: 7,
    username: 'admin',
    displayName: '管理员',
    role: UserRole.ADMIN,
  };

  function fixture(counts = { contractMembers: 0, files: 0 }) {
    const tx = {
      tenant: {
        findUnique: jest.fn().mockResolvedValue({
          id: 19,
          name: '待删除承租人',
          _count: counts,
        }),
        delete: jest.fn().mockResolvedValue({ id: 19 }),
      },
      securityAuditLog: { create: jest.fn().mockResolvedValue({ id: 81 }) },
    };
    const prisma = {
      db: {
        $transaction: jest.fn(
          (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
        ),
      },
    };
    return {
      tx,
      service: new TenantsService(prisma as never, {} as never),
    };
  }

  it('删除没有合同和附件的承租人并写入安全审计', async () => {
    const { tx, service } = fixture();

    await service.remove(19, user);

    expect(tx.tenant.delete).toHaveBeenCalledWith({ where: { id: 19 } });
    expect(tx.securityAuditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        eventType: 'TENANT_DELETE',
        entityType: 'TENANT',
        entityId: 19,
        operatorId: 7,
      }),
    });
  });

  it.each([
    [{ contractMembers: 1, files: 0 }, '该承租人已关联合同，不能删除'],
    [{ contractMembers: 0, files: 1 }, '该承租人已有证件附件，不能删除'],
  ])('存在业务关联时拒绝删除且不写入数据', async (counts, message) => {
    const { tx, service } = fixture(counts);

    await expect(service.remove(19, user)).rejects.toThrow(message);

    expect(tx.tenant.delete).not.toHaveBeenCalled();
    expect(tx.securityAuditLog.create).not.toHaveBeenCalled();
  });

  it('关联检查使用冲突错误供前端显示明确提示', async () => {
    const { service } = fixture({ contractMembers: 1, files: 0 });

    await expect(service.remove(19, user)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});
