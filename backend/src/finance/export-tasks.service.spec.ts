import { ExportFormat, ExportTaskStatus, UserRole } from '@prisma/client';
import { ExportTasksService } from './export-tasks.service';

const user = {
  id: 7,
  username: 'super-admin',
  displayName: '超级管理员',
  role: UserRole.SUPER_ADMIN,
};

describe('ExportTasksService', () => {
  function serviceWith(db: Record<string, unknown>) {
    return new ExportTasksService({ db } as never, {} as never);
  }

  it('creates a pending task owned by the current user', async () => {
    const create = jest.fn().mockResolvedValue({ id: 31, taskNo: 'EX-1' });
    const service = serviceWith({ exportTask: { create } });
    const run = jest
      .spyOn(service as never, 'run')
      .mockResolvedValue(undefined);

    await service.create('rent-collection', ExportFormat.XLSX, {}, user);

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          reportType: 'rent-collection',
          exportFormat: ExportFormat.XLSX,
          createdBy: user.id,
        }),
      }),
    );
    await new Promise((resolve) => setImmediate(resolve));
    expect(run).toHaveBeenCalledWith(31, user);
  });

  it('does not return a completed file belonging to another user', async () => {
    const service = serviceWith({
      exportTask: { findFirst: jest.fn().mockResolvedValue(null) },
    });

    await expect(service.content(9, user)).rejects.toThrow();
  });

  it('requeues pending and interrupted tasks on startup', async () => {
    const service = serviceWith({
      exportTask: {
        findMany: jest.fn().mockResolvedValue([
          { id: 1, createdBy: user.id },
          { id: 2, createdBy: user.id },
        ]),
        update: jest.fn(),
      },
      user: { findUnique: jest.fn().mockResolvedValue(user) },
    });
    const run = jest
      .spyOn(service as never, 'run')
      .mockResolvedValue(undefined);

    await service.onModuleInit();
    await new Promise((resolve) => setImmediate(resolve));

    expect(run).toHaveBeenCalledWith(1, user);
    expect(run).toHaveBeenCalledWith(2, user);
  });

  it('marks a task failed when its creator no longer exists', async () => {
    const update = jest.fn().mockResolvedValue({});
    const service = serviceWith({
      exportTask: {
        findMany: jest.fn().mockResolvedValue([{ id: 1, createdBy: 999 }]),
        update,
      },
      user: { findUnique: jest.fn().mockResolvedValue(null) },
    });

    await service.onModuleInit();

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 1 },
        data: expect.objectContaining({ status: ExportTaskStatus.FAILED }),
      }),
    );
  });
});
