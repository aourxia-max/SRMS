import { ForbiddenException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { ContractDraftsService } from './contract-drafts.service';

const admin = {
  id: 7,
  username: 'admin',
  displayName: 'Admin',
  role: UserRole.ADMIN,
};

const superAdmin = {
  id: 1,
  username: 'root',
  displayName: 'Root',
  role: UserRole.SUPER_ADMIN,
};

describe('ContractDraftsService', () => {
  function serviceWith(db: Record<string, unknown>) {
    return new ContractDraftsService({ db } as never);
  }

  it('creates an incomplete draft owned by the authenticated user', async () => {
    const create = jest.fn().mockResolvedValue({ id: 31 });
    const service = serviceWith({ contractDraft: { create } });

    await service.create({ roomId: 12, remark: 'waiting for tenant' }, admin);

    expect(create).toHaveBeenCalledWith({
      data: {
        roomId: 12,
        payload: { roomId: 12, remark: 'waiting for tenant' },
        status: 'DRAFT',
        createdBy: admin.id,
      },
    });
  });

  it('prevents an admin from reading another admin’s draft', async () => {
    const findFirstOrThrow = jest.fn().mockResolvedValue(null);
    const service = serviceWith({ contractDraft: { findFirstOrThrow } });

    await expect(service.find(18, admin)).rejects.toThrow();

    expect(findFirstOrThrow).toHaveBeenCalledWith({
      where: { id: 18, createdBy: admin.id },
    });
  });

  it('allows a super admin to read any draft', async () => {
    const draft = { id: 18, createdBy: admin.id, status: 'DRAFT' };
    const findFirstOrThrow = jest.fn().mockResolvedValue(draft);
    const service = serviceWith({ contractDraft: { findFirstOrThrow } });

    await expect(service.find(18, superAdmin)).resolves.toEqual(draft);

    expect(findFirstOrThrow).toHaveBeenCalledWith({ where: { id: 18 } });
  });

  it('rejects updates after a draft has been confirmed', async () => {
    const update = jest.fn();
    const service = serviceWith({
      contractDraft: {
        findFirstOrThrow: jest.fn().mockResolvedValue({
          id: 18,
          createdBy: admin.id,
          status: 'CONFIRMED',
        }),
        update,
      },
    });

    await expect(
      service.update(18, { remark: 'too late' }, admin),
    ).rejects.toThrow('草稿已确认');

    expect(update).not.toHaveBeenCalled();
  });

  it('rejects commission data submitted by an admin', async () => {
    const create = jest.fn();
    const service = serviceWith({ contractDraft: { create } });

    await expect(
      service.create(
        { commission: { recipientName: 'Broker', amount: '500' } },
        admin,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(create).not.toHaveBeenCalled();
  });

  it('persists draft status and an authorized commission payload', async () => {
    const update = jest.fn().mockResolvedValue({ id: 18, status: 'DRAFT' });
    const payload = {
      monthlyRent: '3200',
      commission: { recipientName: 'Broker', amount: '500' },
    };
    const service = serviceWith({
      contractDraft: {
        findFirstOrThrow: jest.fn().mockResolvedValue({
          id: 18,
          createdBy: admin.id,
          status: 'DRAFT',
        }),
        update,
      },
    });

    await service.update(18, payload, superAdmin);

    expect(update).toHaveBeenCalledWith({
      where: { id: 18 },
      data: { roomId: null, payload },
    });
  });
});
