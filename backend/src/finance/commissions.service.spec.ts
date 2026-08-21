import { Prisma, UserRole } from '@prisma/client';
import { CommissionsService } from './commissions.service';

describe('CommissionsService', () => {
  const user = {
    id: 7,
    username: 'super',
    displayName: '超级管理员',
    role: UserRole.SUPER_ADMIN,
  };

  it('restores a matching soft-deleted commission instead of violating the unique key', async () => {
    const deleted = {
      id: 31,
      contractId: 8,
      recipientName: '招商主管',
      amount: new Prisma.Decimal('600.00'),
      deletedAt: new Date('2026-08-20T00:00:00.000Z'),
      deletedBy: 9,
    };
    const restored = {
      ...deleted,
      amount: new Prisma.Decimal('800.00'),
      deletedAt: null,
      deletedBy: null,
      updatedBy: 7,
    };
    const create = jest.fn();
    const update = jest.fn().mockResolvedValue(restored);
    const auditCreate = jest.fn().mockResolvedValue({ id: 99 });
    const tx = {
      contract: { findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 8 }) },
      contractCommission: {
        findUnique: jest.fn().mockResolvedValue(deleted),
        create,
        update,
      },
      securityAuditLog: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: auditCreate,
      },
    };
    const prisma = {
      db: {
        $transaction: jest.fn(
          (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
        ),
      },
    } as never;
    const service = new CommissionsService(prisma);

    const result = await service.create(
      { contractId: 8, recipientName: '招商主管', amount: '800.00' },
      user,
    );

    expect(create).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith({
      where: { id: 31 },
      data: {
        amount: new Prisma.Decimal('800.00'),
        deletedAt: null,
        deletedBy: null,
        updatedBy: 7,
      },
    });
    expect(auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        eventType: 'CREATE_COMMISSION',
        entityType: 'CONTRACT_COMMISSION',
        entityId: 31,
        operatorId: 7,
      }),
    });
    expect(result).toEqual(restored);
  });
});
