import { BadRequestException } from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import { unlink, writeFile } from 'fs/promises';
import { FilesService } from './files.service';

jest.mock('fs/promises', () => ({
  mkdir: jest.fn().mockResolvedValue(undefined),
  writeFile: jest.fn().mockResolvedValue(undefined),
  readFile: jest.fn(),
  unlink: jest.fn().mockResolvedValue(undefined),
}));

describe('FilesService append contract file', () => {
  const user = {
    id: 7,
    username: 'admin',
    displayName: '管理员',
    role: UserRole.ADMIN,
  };
  const file = {
    originalname: '补充合同.pdf',
    mimetype: 'application/pdf',
    size: 9,
    buffer: Buffer.from('%PDF-1.7'),
  };
  const storedAsset = {
    id: 41,
    originalName: '补充合同.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 9n,
    uploadedAt: new Date('2026-08-28T00:00:00.000Z'),
  };

  beforeEach(() => {
    jest.mocked(writeFile).mockReset().mockResolvedValue(undefined);
    jest.mocked(unlink).mockReset().mockResolvedValue(undefined);
  });

  function activeTransaction(overrides?: {
    status?: 'ACTIVE' | 'VOIDED';
    fileAssetCreate?: jest.Mock;
    contractFileCreate?: jest.Mock;
    events?: string[];
  }) {
    const events = overrides?.events;
    const contractFindUnique = jest
      .fn()
      .mockImplementationOnce(() => {
        events?.push('resolve-room');
        return Promise.resolve({ id: 12, roomId: 3 });
      })
      .mockImplementationOnce(() => {
        events?.push('reload-contract');
        return Promise.resolve({
          id: 12,
          status: overrides?.status ?? 'ACTIVE',
        });
      });
    const queryRaw = jest.fn().mockImplementation((query) => {
      const sql = (query as { strings: readonly string[] }).strings.join('?');
      if (sql.includes('FROM rooms')) {
        events?.push('lock-room');
        return Promise.resolve([{ id: BigInt(3) }]);
      }
      events?.push('lock-contract');
      return Promise.resolve([{ id: BigInt(12), roomId: BigInt(3) }]);
    });
    const fileAssetCreate =
      overrides?.fileAssetCreate ??
      jest.fn().mockImplementation(() => {
        events?.push('create-asset');
        return Promise.resolve(storedAsset);
      });
    const contractFileCreate =
      overrides?.contractFileCreate ??
      jest.fn().mockImplementation(() => {
        events?.push('link-asset');
        return Promise.resolve({ contractId: 12, fileAssetId: 41 });
      });
    return {
      tx: {
        contract: { findUnique: contractFindUnique },
        fileAsset: { create: fileAssetCreate },
        contractFile: { create: contractFileCreate },
        $queryRaw: queryRaw,
      },
      contractFindUnique,
      queryRaw,
      fileAssetCreate,
      contractFileCreate,
    };
  }

  function serviceWith(options?: {
    initialStatus?: 'ACTIVE' | 'VOIDED';
    transaction?: ReturnType<typeof activeTransaction>;
    transactionFailureAfterCallback?: Error;
    events?: string[];
  }) {
    const initialFindUnique = jest.fn().mockImplementation(() => {
      options?.events?.push('precheck-contract');
      return Promise.resolve({
        id: 12,
        status: options?.initialStatus ?? 'ACTIVE',
      });
    });
    const transactionFixture = options?.transaction ?? activeTransaction();
    const transaction = jest
      .fn()
      .mockImplementation(
        async (
          callback: (tx: typeof transactionFixture.tx) => Promise<unknown>,
        ) => {
          options?.events?.push('transaction-begin');
          const result = await callback(transactionFixture.tx);
          if (options?.transactionFailureAfterCallback)
            throw options.transactionFailureAfterCallback;
          options?.events?.push('transaction-commit');
          return result;
        },
      );
    const unexpectedAssetCreate = jest.fn().mockResolvedValue(storedAsset);
    const unexpectedContractFileCreate = jest.fn().mockResolvedValue({
      contractId: 12,
      fileAssetId: 41,
    });
    const service = new FilesService(
      {
        db: {
          systemSetting: { findUnique: jest.fn().mockResolvedValue(null) },
          contract: { findUnique: initialFindUnique },
          fileAsset: { create: unexpectedAssetCreate },
          contractFile: { create: unexpectedContractFileCreate },
          $transaction: transaction,
        },
      } as never,
      {
        get: jest.fn((key: string) =>
          key === 'TENANT_FILE_MAX_SIZE_BYTES' ? '10485760' : undefined,
        ),
      } as never,
    );
    return {
      service,
      initialFindUnique,
      transaction,
      transactionFixture,
      unexpectedAssetCreate,
      unexpectedContractFileCreate,
    };
  }

  it('rejects a direct append to a VOIDED contract before physical or database writes', async () => {
    const fixture = serviceWith({ initialStatus: 'VOIDED' });

    await expect(
      fixture.service.saveAndLinkContractFile(12, file, user),
    ).rejects.toEqual(new BadRequestException('已作废合同不能追加附件'));

    expect(writeFile).not.toHaveBeenCalled();
    expect(unlink).not.toHaveBeenCalled();
    expect(fixture.transaction).not.toHaveBeenCalled();
    expect(fixture.unexpectedAssetCreate).not.toHaveBeenCalled();
    expect(fixture.unexpectedContractFileCreate).not.toHaveBeenCalled();
  });

  it('rejects when an initially active contract becomes VOIDED before its locked reload', async () => {
    const transactionFixture = activeTransaction({ status: 'VOIDED' });
    const fixture = serviceWith({ transaction: transactionFixture });

    await expect(
      fixture.service.saveAndLinkContractFile(12, file, user),
    ).rejects.toEqual(new BadRequestException('已作废合同不能追加附件'));

    const writtenPath = jest.mocked(writeFile).mock.calls[0]?.[0];
    expect(writeFile).toHaveBeenCalledTimes(1);
    expect(unlink).toHaveBeenCalledWith(writtenPath);
    expect(transactionFixture.fileAssetCreate).not.toHaveBeenCalled();
    expect(transactionFixture.contractFileCreate).not.toHaveBeenCalled();
  });

  it('writes the file, then locks room and target contract before reloading and atomically linking it in ReadCommitted', async () => {
    const events: string[] = [];
    jest.mocked(writeFile).mockImplementation(() => {
      events.push('write-file');
      return Promise.resolve();
    });
    const transactionFixture = activeTransaction({ events });
    const fixture = serviceWith({ transaction: transactionFixture, events });

    await expect(
      fixture.service.saveAndLinkContractFile(12, file, user),
    ).resolves.toEqual({
      id: 41,
      originalName: '补充合同.pdf',
      mimeType: 'application/pdf',
      sizeBytes: '9',
      uploadedAt: storedAsset.uploadedAt,
    });

    expect(fixture.transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
    });
    expect(events).toEqual([
      'precheck-contract',
      'write-file',
      'transaction-begin',
      'resolve-room',
      'lock-room',
      'lock-contract',
      'reload-contract',
      'create-asset',
      'link-asset',
      'transaction-commit',
    ]);
    expect(transactionFixture.contractFindUnique).toHaveBeenLastCalledWith({
      where: { id: 12 },
      select: { id: true, status: true },
    });
    expect(transactionFixture.fileAssetCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        category: 'CONTRACT',
        uploadedBy: user.id,
        storageKey: expect.stringMatching(/^contract-files\//),
      }),
    });
    expect(transactionFixture.contractFileCreate).toHaveBeenCalledWith({
      data: { contractId: 12, fileAssetId: 41 },
    });
    expect(fixture.unexpectedAssetCreate).not.toHaveBeenCalled();
    expect(fixture.unexpectedContractFileCreate).not.toHaveBeenCalled();
    expect(unlink).not.toHaveBeenCalled();
  });

  it('removes the just-written physical file when transactional FileAsset creation fails', async () => {
    const failure = new Error('file asset create failed');
    const transactionFixture = activeTransaction({
      fileAssetCreate: jest.fn().mockRejectedValue(failure),
    });
    const fixture = serviceWith({ transaction: transactionFixture });

    await expect(
      fixture.service.saveAndLinkContractFile(12, file, user),
    ).rejects.toBe(failure);

    const writtenPath = jest.mocked(writeFile).mock.calls[0]?.[0];
    expect(unlink).toHaveBeenCalledWith(writtenPath);
    expect(transactionFixture.contractFileCreate).not.toHaveBeenCalled();
  });

  it('removes the just-written physical file when transactional ContractFile linking fails', async () => {
    const failure = new Error('contract file link failed');
    const transactionFixture = activeTransaction({
      contractFileCreate: jest.fn().mockRejectedValue(failure),
    });
    const fixture = serviceWith({ transaction: transactionFixture });

    await expect(
      fixture.service.saveAndLinkContractFile(12, file, user),
    ).rejects.toBe(failure);

    const writtenPath = jest.mocked(writeFile).mock.calls[0]?.[0];
    expect(unlink).toHaveBeenCalledWith(writtenPath);
    expect(transactionFixture.fileAssetCreate).toHaveBeenCalledTimes(1);
  });

  it('removes the just-written physical file when transaction commit fails', async () => {
    const failure = new Error('commit failed');
    const transactionFixture = activeTransaction();
    const fixture = serviceWith({
      transaction: transactionFixture,
      transactionFailureAfterCallback: failure,
    });

    await expect(
      fixture.service.saveAndLinkContractFile(12, file, user),
    ).rejects.toBe(failure);

    const writtenPath = jest.mocked(writeFile).mock.calls[0]?.[0];
    expect(unlink).toHaveBeenCalledWith(writtenPath);
    expect(transactionFixture.fileAssetCreate).toHaveBeenCalledTimes(1);
    expect(transactionFixture.contractFileCreate).toHaveBeenCalledTimes(1);
  });
});
