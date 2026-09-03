import { mkdir, readFile, unlink, writeFile } from 'fs/promises';
import { resolve } from 'path';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import {
  CONTRACT_VOID_PROOF_STAGED_TTL_MS,
  FilesService,
  safeStoredFileName,
} from './files.service';

jest.mock('fs/promises', () => ({
  mkdir: jest.fn().mockResolvedValue(undefined),
  writeFile: jest.fn().mockResolvedValue(undefined),
  readFile: jest.fn(),
  unlink: jest.fn().mockResolvedValue(undefined),
}));

describe('FilesService payment proofs', () => {
  it('normalizes Windows and POSIX traversal separators in stored file names', () => {
    expect(safeStoredFileName('..\\..\\outside.pdf')).toBe('outside.pdf');
    expect(safeStoredFileName('../../outside.pdf')).toBe('outside.pdf');
  });

  it('accepts a real WebP signature and stores it as a staged payment proof', async () => {
    const create = jest.fn().mockResolvedValue({
      id: 31,
      originalName: 'receipt.webp',
      mimeType: 'image/webp',
      sizeBytes: 16n,
      uploadedAt: new Date('2026-08-04T00:00:00Z'),
    });
    const service = new FilesService(
      {
        db: {
          systemSetting: { findUnique: jest.fn().mockResolvedValue(null) },
          fileAsset: { create },
        },
      } as never,
      {
        get: jest.fn((key: string) =>
          key === 'TENANT_FILE_MAX_SIZE_BYTES'
            ? '10485760'
            : 'application/pdf,image/jpeg,image/png,image/heic',
        ),
      } as never,
    );
    const content = Buffer.concat([
      Buffer.from('RIFF'),
      Buffer.alloc(4),
      Buffer.from('WEBP'),
      Buffer.alloc(4),
    ]);

    const result = await service.savePaymentProof(
      {
        originalname: 'receipt.webp',
        mimetype: 'image/webp',
        size: content.length,
        buffer: content,
      },
      {
        id: 3,
        username: 'cashier',
        displayName: '收款员',
        role: UserRole.ADMIN,
      },
    );

    expect(result).toEqual(
      expect.objectContaining({ id: 31, sizeBytes: '16' }),
    );
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        category: 'PAYMENT_PROOF',
        uploadedBy: 3,
        mimeType: 'image/webp',
      }),
    });
  });

  it('rejects a file whose content does not match its image MIME type', async () => {
    const service = new FilesService(
      {
        db: {
          systemSetting: { findUnique: jest.fn().mockResolvedValue(null) },
        },
      } as never,
      {
        get: jest.fn((key: string) =>
          key === 'TENANT_FILE_MAX_SIZE_BYTES'
            ? '10485760'
            : 'image/jpeg,image/png,image/webp',
        ),
      } as never,
    );

    await expect(
      service.savePaymentProof(
        {
          originalname: 'fake.png',
          mimetype: 'image/png',
          size: 4,
          buffer: Buffer.from('fake'),
        },
        {
          id: 3,
          username: 'cashier',
          displayName: '收款员',
          role: UserRole.ADMIN,
        },
      ),
    ).rejects.toThrow('附件类型或内容不符合限制');
  });

  it('does not broaden GIF support to payment proof uploads', async () => {
    const service = new FilesService(
      {
        db: {
          systemSetting: { findUnique: jest.fn().mockResolvedValue(null) },
        },
      } as never,
      {
        get: jest.fn((key: string) =>
          key === 'TENANT_FILE_MAX_SIZE_BYTES'
            ? '10485760'
            : 'image/jpeg,image/png,image/webp,image/gif',
        ),
      } as never,
    );
    const content = Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(8)]);

    await expect(
      service.savePaymentProof(
        {
          originalname: 'receipt.gif',
          mimetype: 'image/gif',
          size: content.length,
          buffer: content,
        },
        {
          id: 3,
          username: 'cashier',
          displayName: '收款员',
          role: UserRole.ADMIN,
        },
      ),
    ).rejects.toThrow('附件类型或内容不符合限制');
  });

  it('downloads only a proof linked to the requested payment', async () => {
    jest.mocked(readFile).mockResolvedValue(Buffer.from('proof'));
    const service = new FilesService(
      {
        db: {
          paymentFile: {
            findUnique: jest.fn().mockResolvedValue({
              paymentId: 81,
              fileAssetId: 31,
              fileAsset: {
                id: 31,
                storedName: 'stored.webp',
                originalName: 'receipt.webp',
                mimeType: 'image/webp',
              },
            }),
          },
        },
      } as never,
      {} as never,
    );

    const result = await service.downloadPaymentProof(81, 31);

    expect(result.content.toString()).toBe('proof');
    expect(result.asset.originalName).toBe('receipt.webp');
  });
});

describe('FilesService deposit refund proofs', () => {
  function serviceWith(findFirst: jest.Mock) {
    return new FilesService(
      { db: { depositRefundFile: { findFirst } } } as never,
      {} as never,
    );
  }

  it('downloads only a proof linked to the requested deposit refund', async () => {
    jest.mocked(readFile).mockResolvedValue(Buffer.from('refund-proof'));
    const findFirst = jest.fn().mockResolvedValue({
      depositRefundId: 6,
      fileAssetId: 77,
      fileAsset: {
        id: 77,
        category: 'DEPOSIT_REFUND_PROOF',
        storedName: 'stored-proof.webp',
        originalName: '退款凭证.webp',
        mimeType: 'image/webp',
      },
    });
    const service = serviceWith(findFirst);

    await expect(
      Promise.resolve().then(() =>
        (
          service as unknown as {
            downloadDepositRefundProof: (
              refundId: number,
              fileId: number,
            ) => Promise<{ asset: { originalName: string }; content: Buffer }>;
          }
        ).downloadDepositRefundProof(6, 77),
      ),
    ).resolves.toEqual(
      expect.objectContaining({
        asset: expect.objectContaining({ originalName: '退款凭证.webp' }),
        content: Buffer.from('refund-proof'),
      }),
    );
    expect(findFirst).toHaveBeenCalledWith({
      where: {
        depositRefundId: 6,
        fileAssetId: 77,
        fileAsset: { category: 'DEPOSIT_REFUND_PROOF' },
      },
      include: { fileAsset: true },
    });
  });

  it('rejects a file that is not linked to the requested deposit refund', async () => {
    const service = serviceWith(jest.fn().mockResolvedValue(null));

    await expect(
      Promise.resolve().then(() =>
        (
          service as unknown as {
            downloadDepositRefundProof: (
              refundId: number,
              fileId: number,
            ) => Promise<unknown>;
          }
        ).downloadDepositRefundProof(6, 99),
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
describe('FilesService contract files', () => {
  const user = {
    id: 7,
    username: 'admin',
    displayName: '管理员',
    role: UserRole.ADMIN,
  };
  const fileContents = {
    'application/pdf': Buffer.from('%PDF-1.7\n'),
    'image/jpeg': Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
    'image/png': Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    'image/webp': Buffer.concat([
      Buffer.from('RIFF'),
      Buffer.alloc(4),
      Buffer.from('WEBP'),
    ]),
  } as const;
  const extensions = {
    'application/pdf': '.pdf',
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
  } as const;

  function serviceWith(overrides?: {
    create?: jest.Mock;
    maxBytes?: string;
    contractFile?: Record<string, jest.Mock>;
  }) {
    return new FilesService(
      {
        db: {
          systemSetting: { findUnique: jest.fn().mockResolvedValue(null) },
          fileAsset: {
            create:
              overrides?.create ??
              jest.fn().mockResolvedValue({
                id: 41,
                originalName: 'contract.pdf',
                mimeType: 'application/pdf',
                sizeBytes: 9n,
                uploadedAt: new Date('2026-08-05T00:00:00Z'),
              }),
          },
          contractFile: overrides?.contractFile ?? {},
        },
      } as never,
      {
        get: jest.fn((key: string) =>
          key === 'TENANT_FILE_MAX_SIZE_BYTES'
            ? (overrides?.maxBytes ?? '10485760')
            : undefined,
        ),
      } as never,
    );
  }

  it.each(Object.keys(fileContents) as Array<keyof typeof fileContents>)(
    'stores a genuine %s upload as an unlinked contract asset',
    async (mimetype) => {
      const create = jest.fn().mockImplementation(({ data }) =>
        Promise.resolve({
          id: 41,
          originalName: data.originalName,
          mimeType: data.mimeType,
          sizeBytes: data.sizeBytes,
          uploadedAt: new Date('2026-08-05T00:00:00Z'),
        }),
      );
      const content = fileContents[mimetype];
      const extension = extensions[mimetype];

      await expect(
        serviceWith({ create }).saveContractFile(
          {
            originalname: `signed-contract${extension}`,
            mimetype,
            size: content.length,
            buffer: content,
          },
          user,
        ),
      ).resolves.toEqual(
        expect.objectContaining({
          id: 41,
          originalName: `signed-contract${extension}`,
          mimeType: mimetype,
          sizeBytes: String(content.length),
        }),
      );
      expect(create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          category: 'CONTRACT',
          storageKey: expect.stringMatching(/^contract-files\//),
          uploadedBy: user.id,
        }),
      });
      expect(writeFile).toHaveBeenCalledWith(
        expect.stringContaining('contract-files'),
        content,
        { flag: 'wx' },
      );
    },
  );

  it.each(['GIF87a', 'GIF89a'])(
    'stores a genuine %s contract upload with a .gif extension',
    async (signature) => {
      const create = jest.fn().mockImplementation(({ data }) =>
        Promise.resolve({
          id: 42,
          originalName: data.originalName,
          mimeType: data.mimeType,
          sizeBytes: data.sizeBytes,
          uploadedAt: new Date('2026-08-05T00:00:00Z'),
        }),
      );
      const content = Buffer.concat([Buffer.from(signature), Buffer.alloc(8)]);

      await expect(
        serviceWith({ create }).saveContractFile(
          {
            originalname: 'signed-contract.gif',
            mimetype: 'image/gif',
            size: content.length,
            buffer: content,
          },
          user,
        ),
      ).resolves.toEqual(
        expect.objectContaining({
          id: 42,
          originalName: 'signed-contract.gif',
          mimeType: 'image/gif',
          sizeBytes: String(content.length),
        }),
      );
      expect(create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          category: 'CONTRACT',
          extension: '.gif',
          mimeType: 'image/gif',
        }),
      });
    },
  );

  it('rejects a GIF MIME when its content has no GIF87a or GIF89a signature', async () => {
    await expect(
      serviceWith().saveContractFile(
        {
          originalname: 'contract.gif',
          mimetype: 'image/gif',
          size: 8,
          buffer: Buffer.from('not-gif!'),
        },
        user,
      ),
    ).rejects.toThrow('附件类型或内容不符合限制');
  });

  it('rejects a genuine GIF signature when the filename extension is not .gif', async () => {
    const content = Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(8)]);
    await expect(
      serviceWith().saveContractFile(
        {
          originalname: 'contract.png',
          mimetype: 'image/gif',
          size: content.length,
          buffer: content,
        },
        user,
      ),
    ).rejects.toThrow('附件类型或内容不符合限制');
  });

  it('rejects a declared MIME whose content has no matching signature', async () => {
    await expect(
      serviceWith().saveContractFile(
        {
          originalname: 'contract.pdf',
          mimetype: 'application/pdf',
          size: 8,
          buffer: Buffer.from('not-pdf!'),
        },
        user,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a genuine signature whose filename extension mismatches the MIME', async () => {
    const content = fileContents['image/png'];
    await expect(
      serviceWith().saveContractFile(
        {
          originalname: 'contract.jpg',
          mimetype: 'image/png',
          size: content.length,
          buffer: content,
        },
        user,
      ),
    ).rejects.toThrow('附件类型或内容不符合限制');
  });

  it('rejects a contract file over the system upload limit', async () => {
    const content = fileContents['application/pdf'];
    await expect(
      serviceWith({ maxBytes: '4' }).saveContractFile(
        {
          originalname: 'contract.pdf',
          mimetype: 'application/pdf',
          size: content.length,
          buffer: content,
        },
        user,
      ),
    ).rejects.toThrow('附件超过允许大小');
  });

  it('lists only file assets linked to the requested contract without sensitive fields', async () => {
    const findMany = jest.fn().mockImplementation(({ where }) =>
      Promise.resolve(
        where.fileAsset?.category === 'CONTRACT'
          ? [
              {
                fileAsset: {
                  id: 41,
                  originalName: 'contract.pdf',
                  mimeType: 'application/pdf',
                  sizeBytes: 9n,
                  uploadedAt: new Date('2026-08-05T00:00:00Z'),
                  storageKey: 'contract-files/secret.pdf',
                  sha256: 'secret',
                },
              },
            ]
          : [],
      ),
    );

    await expect(
      serviceWith({ contractFile: { findMany } }).listContractFiles(12),
    ).resolves.toEqual([
      {
        id: 41,
        originalName: 'contract.pdf',
        mimeType: 'application/pdf',
        sizeBytes: '9',
        uploadedAt: new Date('2026-08-05T00:00:00Z'),
      },
    ]);
    expect(findMany).toHaveBeenCalledWith({
      where: { contractId: 12, fileAsset: { category: 'CONTRACT' } },
      include: { fileAsset: true },
      orderBy: { createdAt: 'desc' },
    });
  });

  it('downloads only an asset linked to the requested contract', async () => {
    jest.mocked(readFile).mockResolvedValue(Buffer.from('contract'));
    const linkedFile = {
      contractId: 12,
      fileAssetId: 41,
      fileAsset: {
        id: 41,
        category: 'CONTRACT',
        storedName: 'stored.pdf',
        originalName: 'signed-contract.pdf',
        mimeType: 'application/pdf',
      },
    };
    const findUnique = jest.fn().mockResolvedValue(linkedFile);
    const findFirst = jest.fn().mockResolvedValue(linkedFile);
    const service = serviceWith({ contractFile: { findUnique, findFirst } });

    const result = await service.downloadContractFile(12, 41);

    expect(findFirst).toHaveBeenCalledWith({
      where: {
        contractId: 12,
        fileAssetId: 41,
        fileAsset: { category: 'CONTRACT' },
      },
      include: { fileAsset: true },
    });
    expect(result.content.toString()).toBe('contract');
    expect(result.asset.originalName).toBe('signed-contract.pdf');
  });

  it('rejects downloading an asset that is not linked to the requested contract', async () => {
    await expect(
      serviceWith({
        contractFile: {
          findUnique: jest.fn().mockResolvedValue(null),
          findFirst: jest.fn().mockResolvedValue(null),
        },
      }).downloadContractFile(12, 99),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects a malformed association to a non-contract file asset', async () => {
    const malformed = {
      contractId: 12,
      fileAssetId: 51,
      fileAsset: {
        id: 51,
        category: 'TENANT_ID',
        storedName: 'tenant-id.pdf',
        originalName: 'tenant-id.pdf',
        mimeType: 'application/pdf',
      },
    };
    await expect(
      serviceWith({
        contractFile: {
          findUnique: jest.fn().mockResolvedValue(malformed),
          findFirst: jest
            .fn()
            .mockImplementation(({ where }) =>
              Promise.resolve(
                where.fileAsset?.category === 'CONTRACT' ? null : malformed,
              ),
            ),
        },
      }).downloadContractFile(12, 51),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('FilesService contract void proofs', () => {
  beforeEach(() => {
    jest.mocked(readFile).mockReset();
    jest.mocked(writeFile).mockReset().mockResolvedValue(undefined);
    jest.mocked(unlink).mockReset().mockResolvedValue(undefined);
  });

  const admin = {
    id: 2,
    username: 'admin',
    displayName: '管理员',
    role: UserRole.ADMIN,
  };

  it('stores a validated proof as a staged contract-void asset', async () => {
    const create = jest.fn().mockResolvedValue({
      id: 61,
      originalName: 'proof.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 9n,
      uploadedAt: new Date('2026-08-26T00:00:00Z'),
    });
    const service = new FilesService(
      {
        db: {
          systemSetting: { findUnique: jest.fn().mockResolvedValue(null) },
          fileAsset: { findMany: jest.fn().mockResolvedValue([]), create },
        },
      } as never,
      {
        get: jest.fn((key: string) =>
          key === 'TENANT_FILE_MAX_SIZE_BYTES'
            ? '10485760'
            : 'application/pdf,image/jpeg,image/png,image/webp',
        ),
      } as never,
    );
    const content = Buffer.from('%PDF-1.7');

    await expect(
      service.saveContractVoidProof(
        {
          originalname: 'proof.pdf',
          mimetype: 'application/pdf',
          size: content.length,
          buffer: content,
        },
        {
          id: 2,
          username: 'admin',
          displayName: '\u7ba1\u7406\u5458',
          role: UserRole.ADMIN,
        },
      ),
    ).resolves.toEqual(expect.objectContaining({ id: 61, sizeBytes: '9' }));
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        category: 'CONTRACT_VOID_PROOF',
        uploadedBy: 2,
        sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      }),
    });
  });

  it('rejects visitor uploads in the service layer before file handling', async () => {
    const service = new FilesService({ db: {} } as never, {} as never);

    await expect(
      service.saveContractVoidProof(undefined as never, {
        id: 3,
        username: 'visitor',
        displayName: '访客',
        role: UserRole.VISITOR,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('downloads only a proof linked to the requested void request and neutralizes stored-name traversal', async () => {
    jest.mocked(readFile).mockResolvedValue(Buffer.from('void-proof'));
    const findFirst = jest.fn().mockResolvedValue({
      contractVoidRequestId: 901,
      fileAssetId: 501,
      fileAsset: {
        id: 501,
        category: 'CONTRACT_VOID_PROOF',
        storedName: '../../outside.png',
        originalName: '作废证明.png',
        mimeType: 'image/png',
      },
    });
    const service = new FilesService(
      { db: { contractVoidRequestFile: { findFirst } } } as never,
      {} as never,
    );
    const user = {
      id: 2,
      username: 'admin',
      displayName: '管理员',
      role: UserRole.ADMIN,
    };

    const result = await (
      service as unknown as {
        downloadContractVoidProof: (
          requestId: number,
          fileId: number,
          user: typeof user,
        ) => Promise<{ asset: { originalName: string }; content: Buffer }>;
      }
    ).downloadContractVoidProof(901, 501, user);

    expect(findFirst).toHaveBeenCalledWith({
      where: {
        contractVoidRequestId: 901,
        fileAssetId: 501,
        fileAsset: { category: 'CONTRACT_VOID_PROOF' },
      },
      include: { fileAsset: true },
    });
    expect(readFile).toHaveBeenCalledWith(
      resolve(
        process.cwd(),
        '..',
        'uploads',
        'contract-void-proofs',
        'outside.png',
      ),
    );
    expect(result.content.toString()).toBe('void-proof');
    expect(result.asset.originalName).toBe('作废证明.png');
  });

  it('rejects an unlinked or wrong-category asset for the requested void request', async () => {
    const findFirst = jest.fn().mockResolvedValue(null);
    const service = new FilesService(
      { db: { contractVoidRequestFile: { findFirst } } } as never,
      {} as never,
    );
    const user = {
      id: 2,
      username: 'admin',
      displayName: '管理员',
      role: UserRole.ADMIN,
    };

    await expect(
      (service as any).downloadContractVoidProof(901, 999, user),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          contractVoidRequestId: 901,
          fileAssetId: 999,
          fileAsset: { category: 'CONTRACT_VOID_PROOF' },
        }),
      }),
    );
  });

  it('rejects visitor proof downloads before querying file metadata', async () => {
    const findFirst = jest.fn();
    const service = new FilesService(
      { db: { contractVoidRequestFile: { findFirst } } } as never,
      {} as never,
    );

    await expect(
      (service as any).downloadContractVoidProof(901, 501, {
        id: 3,
        username: 'visitor',
        displayName: '访客',
        role: UserRole.VISITOR,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('removes the just-written physical proof if FileAsset creation fails', async () => {
    const failure = new Error('database unavailable');
    const create = jest.fn().mockRejectedValue(failure);
    const service = new FilesService(
      {
        db: {
          systemSetting: { findUnique: jest.fn().mockResolvedValue(null) },
          fileAsset: {
            findMany: jest.fn().mockResolvedValue([]),
            create,
          },
        },
      } as never,
      {
        get: jest.fn((key: string) =>
          key === 'TENANT_FILE_MAX_SIZE_BYTES'
            ? '10485760'
            : 'application/pdf,image/jpeg,image/png,image/webp',
        ),
      } as never,
    );
    const content = Buffer.from('%PDF-1.7');

    await expect(
      service.saveContractVoidProof(
        {
          originalname: 'proof.pdf',
          mimetype: 'application/pdf',
          size: content.length,
          buffer: content,
        },
        admin,
      ),
    ).rejects.toBe(failure);

    const writtenPath = jest.mocked(writeFile).mock.calls.at(-1)?.[0];
    expect(unlink).toHaveBeenCalledWith(writtenPath);
  });

  it('lets only the uploader delete an unlocked unassociated staged proof', async () => {
    const asset = {
      id: 61,
      category: 'CONTRACT_VOID_PROOF',
      uploadedBy: admin.id,
      lockedAt: null,
      storedName: '../../staged-proof.pdf',
      contractVoidRequestFiles: [],
    };
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const deleteMany = jest.fn().mockResolvedValue({ count: 1 });
    const service = new FilesService(
      {
        db: {
          fileAsset: {
            findUnique: jest.fn().mockResolvedValue(asset),
            updateMany,
            deleteMany,
          },
        },
      } as never,
      {} as never,
    );

    await expect(service.deleteContractVoidProof(61, admin)).resolves.toEqual({
      id: 61,
    });
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: 61,
        category: 'CONTRACT_VOID_PROOF',
        uploadedBy: admin.id,
        lockedAt: null,
        contractVoidRequestFiles: { none: {} },
      },
      data: { lockedAt: expect.any(Date) },
    });
    expect(unlink).toHaveBeenCalledWith(
      resolve(
        process.cwd(),
        '..',
        'uploads',
        'contract-void-proofs',
        'staged-proof.pdf',
      ),
    );
    expect(deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 61,
          contractVoidRequestFiles: { none: {} },
        }),
      }),
    );
  });

  it.each([
    [
      'other uploader',
      { uploadedBy: 99, lockedAt: null, contractVoidRequestFiles: [] },
      ForbiddenException,
    ],
    [
      'locked',
      {
        uploadedBy: admin.id,
        lockedAt: new Date(),
        contractVoidRequestFiles: [],
      },
      ConflictException,
    ],
    [
      'associated',
      {
        uploadedBy: admin.id,
        lockedAt: null,
        contractVoidRequestFiles: [{ contractVoidRequestId: 901 }],
      },
      ConflictException,
    ],
  ])(
    'rejects deletion of a %s proof without touching disk',
    async (_case, state, errorType) => {
      const service = new FilesService(
        {
          db: {
            fileAsset: {
              findUnique: jest.fn().mockResolvedValue({
                id: 61,
                category: 'CONTRACT_VOID_PROOF',
                storedName: 'proof.pdf',
                ...state,
              }),
              updateMany: jest.fn(),
              deleteMany: jest.fn(),
            },
          },
        } as never,
        {} as never,
      );

      await expect(
        service.deleteContractVoidProof(61, admin),
      ).rejects.toBeInstanceOf(errorType);
      expect(unlink).not.toHaveBeenCalled();
    },
  );

  it('opportunistically removes unlocked proofs older than the named 24-hour TTL', async () => {
    expect(CONTRACT_VOID_PROOF_STAGED_TTL_MS).toBe(24 * 60 * 60 * 1000);
    const findMany = jest.fn().mockResolvedValue([
      {
        id: 50,
        storedName: '../../expired.pdf',
        uploadedAt: new Date('2026-08-24T00:00:00.000Z'),
      },
    ]);
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const deleteMany = jest.fn().mockResolvedValue({ count: 1 });
    const create = jest.fn().mockResolvedValue({
      id: 61,
      originalName: 'new.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 9n,
      uploadedAt: new Date(),
    });
    const service = new FilesService(
      {
        db: {
          systemSetting: { findUnique: jest.fn().mockResolvedValue(null) },
          fileAsset: { findMany, updateMany, deleteMany, create },
        },
      } as never,
      {
        get: jest.fn((key: string) =>
          key === 'TENANT_FILE_MAX_SIZE_BYTES'
            ? '10485760'
            : 'application/pdf,image/jpeg,image/png,image/webp',
        ),
      } as never,
    );
    const before = Date.now();
    const content = Buffer.from('%PDF-1.7');

    await service.saveContractVoidProof(
      {
        originalname: 'new.pdf',
        mimetype: 'application/pdf',
        size: content.length,
        buffer: content,
      },
      admin,
    );
    const after = Date.now();

    const cutoff = findMany.mock.calls[0][0].where.uploadedAt.lt as Date;
    const cleanupStartedAt =
      cutoff.getTime() + CONTRACT_VOID_PROOF_STAGED_TTL_MS;
    expect(cleanupStartedAt).toBeGreaterThanOrEqual(before);
    expect(cleanupStartedAt).toBeLessThanOrEqual(after);
    expect(findMany).toHaveBeenCalledWith({
      where: {
        category: 'CONTRACT_VOID_PROOF',
        lockedAt: null,
        uploadedAt: { lt: expect.any(Date) },
        contractVoidRequestFiles: { none: {} },
      },
      select: { id: true, storedName: true, uploadedAt: true },
    });
    expect(unlink).toHaveBeenCalledWith(
      resolve(
        process.cwd(),
        '..',
        'uploads',
        'contract-void-proofs',
        'expired.pdf',
      ),
    );
    expect(deleteMany).toHaveBeenCalled();
    expect(create).toHaveBeenCalled();
  });

  it('does not block a new upload when expired-proof physical cleanup fails', async () => {
    const findMany = jest.fn().mockResolvedValue([
      {
        id: 50,
        storedName: 'expired.pdf',
        uploadedAt: new Date('2026-08-24T00:00:00.000Z'),
      },
    ]);
    const updateMany = jest
      .fn()
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 1 });
    const create = jest.fn().mockResolvedValue({
      id: 61,
      originalName: 'new.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 9n,
      uploadedAt: new Date(),
    });
    jest
      .mocked(unlink)
      .mockRejectedValueOnce(
        Object.assign(new Error('permission denied'), { code: 'EACCES' }),
      );
    const service = new FilesService(
      {
        db: {
          systemSetting: { findUnique: jest.fn().mockResolvedValue(null) },
          fileAsset: { findMany, updateMany, deleteMany: jest.fn(), create },
        },
      } as never,
      {
        get: jest.fn((key: string) =>
          key === 'TENANT_FILE_MAX_SIZE_BYTES'
            ? '10485760'
            : 'application/pdf,image/jpeg,image/png,image/webp',
        ),
      } as never,
    );
    const content = Buffer.from('%PDF-1.7');

    await expect(
      service.saveContractVoidProof(
        {
          originalname: 'new.pdf',
          mimetype: 'application/pdf',
          size: content.length,
          buffer: content,
        },
        admin,
      ),
    ).resolves.toMatchObject({ id: 61 });
    expect(updateMany).toHaveBeenLastCalledWith({
      where: {
        id: 50,
        category: 'CONTRACT_VOID_PROOF',
        lockedAt: expect.any(Date),
      },
      data: { lockedAt: null },
    });
    expect(create).toHaveBeenCalled();
  });

  it('maps a missing physical proof to a Chinese 404 without leaking its path', async () => {
    const findFirst = jest.fn().mockResolvedValue({
      fileAsset: {
        category: 'CONTRACT_VOID_PROOF',
        storedName: 'missing-secret.pdf',
      },
    });
    jest.mocked(readFile).mockRejectedValue(
      Object.assign(new Error('ENOENT D:/secret/missing-secret.pdf'), {
        code: 'ENOENT',
      }),
    );
    const service = new FilesService(
      {
        db: {
          contractVoidRequestFile: { findFirst },
        },
      } as never,
      {} as never,
    );

    await expect(
      service.downloadContractVoidProof(901, 501, admin),
    ).rejects.toEqual(
      expect.objectContaining({ message: '合同作废证明文件不存在' }),
    );
    await expect(
      service.downloadContractVoidProof(901, 501, admin),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('maps other proof read failures to a Chinese service error without leaking its path', async () => {
    const findFirst = jest.fn().mockResolvedValue({
      fileAsset: {
        category: 'CONTRACT_VOID_PROOF',
        storedName: 'private-secret.pdf',
      },
    });
    jest.mocked(readFile).mockRejectedValue(
      Object.assign(new Error('EACCES D:/secret/private-secret.pdf'), {
        code: 'EACCES',
      }),
    );
    const service = new FilesService(
      {
        db: {
          contractVoidRequestFile: { findFirst },
        },
      } as never,
      {} as never,
    );

    const failure = service.downloadContractVoidProof(901, 501, admin);
    await expect(failure).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(failure).rejects.toEqual(
      expect.objectContaining({
        message: '合同作废证明文件读取失败，请稍后重试',
      }),
    );
    await failure.catch((error: Error) =>
      expect(error.message).not.toContain('secret'),
    );
  });
});

describe('FilesService property-affair attachments', () => {
  const admin = {
    id: 7,
    username: 'admin',
    displayName: '管理员',
    role: UserRole.ADMIN,
  };
  const visitor = { ...admin, id: 8, role: UserRole.VISITOR };
  const uploadedAt = new Date('2026-09-02T01:02:03.000Z');
  const acceptedFiles = [
    ['image/jpeg', '.jpg', Buffer.from([0xff, 0xd8, 0xff, 0xe0])],
    ['image/jpeg', '.jpeg', Buffer.from([0xff, 0xd8, 0xff, 0xe0])],
    ['image/png', '.png', Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])],
    [
      'image/webp',
      '.webp',
      Buffer.concat([
        Buffer.from('RIFF'),
        Buffer.alloc(4),
        Buffer.from('WEBP'),
      ]),
    ],
    ['application/pdf', '.pdf', Buffer.from('%PDF-1.7\n')],
    [
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      '.docx',
      Buffer.from('PK\u0003\u0004word'),
    ],
    [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      '.xlsx',
      Buffer.from('PK\u0003\u0004xl'),
    ],
  ] as const;

  function uploadFixture(options?: {
    affair?: { id: number; affairNo: string; deletedAt: Date | null } | null;
    txAffair?: { id: number; affairNo: string; deletedAt: Date | null } | null;
    transactionError?: Error;
    maxBytes?: string;
  }) {
    const affair =
      options && 'affair' in options
        ? options.affair
        : { id: 41, affairNo: 'WY202609020001', deletedAt: null };
    const txAffair =
      options && 'txAffair' in options ? options.txAffair : affair;
    const tx = {
      propertyAffair: { findFirst: jest.fn().mockResolvedValue(txAffair) },
      fileAsset: {
        create: jest.fn().mockImplementation(({ data }) =>
          Promise.resolve({
            id: 71,
            originalName: data.originalName,
            mimeType: data.mimeType,
            sizeBytes: data.sizeBytes,
            uploadedAt,
          }),
        ),
      },
      propertyAffairFile: { create: jest.fn().mockResolvedValue({}) },
      operationLog: { create: jest.fn().mockResolvedValue({ id: 1 }) },
    };
    const db = {
      systemSetting: { findUnique: jest.fn().mockResolvedValue(null) },
      propertyAffair: { findFirst: jest.fn().mockResolvedValue(affair) },
      $transaction: jest
        .fn()
        .mockImplementation(
          (callback: (client: typeof tx) => Promise<unknown>) => {
            if (options?.transactionError)
              return Promise.reject(options.transactionError);
            return callback(tx);
          },
        ),
    };
    const service = new FilesService(
      { db } as never,
      {
        get: jest.fn((key: string) =>
          key === 'TENANT_FILE_MAX_SIZE_BYTES'
            ? (options?.maxBytes ?? '10485760')
            : undefined,
        ),
      } as never,
    );
    return { service, db, tx };
  }

  function save(
    service: FilesService,
    affairId: number,
    file: unknown,
    user = admin,
  ) {
    return (
      service as unknown as {
        saveAndLinkPropertyAffairFile: (
          affairId: number,
          file: unknown,
          user: typeof admin,
        ) => Promise<unknown>;
      }
    ).saveAndLinkPropertyAffairFile(affairId, file, user);
  }

  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(mkdir).mockReset().mockResolvedValue(undefined);
    jest.mocked(writeFile).mockReset().mockResolvedValue(undefined);
    jest.mocked(unlink).mockReset().mockResolvedValue(undefined);
  });

  it.each(acceptedFiles)(
    'accepts exact %s + %s + magic and transactionally stores and audits the link',
    async (mimetype, extension, buffer) => {
      const { service, db, tx } = uploadFixture();

      const result = await save(service, 41, {
        originalname: `../证明${extension}`,
        mimetype,
        size: buffer.length,
        buffer,
      });

      expect(result).toEqual({
        id: 71,
        originalName: `证明${extension}`,
        mimeType: mimetype,
        sizeBytes: String(buffer.length),
        uploadedAt,
      });
      expect(() => JSON.stringify(result)).not.toThrow();
      expect(db.$transaction).toHaveBeenCalledTimes(1);
      expect(tx.propertyAffair.findFirst).toHaveBeenCalledWith({
        where: { id: 41, deletedAt: null },
        select: { id: true, affairNo: true, deletedAt: true },
      });
      expect(tx.fileAsset.create).toHaveBeenCalledWith({
        data: {
          storageKey: expect.stringMatching(/^property-affairs\//),
          originalName: `证明${extension}`,
          storedName: expect.stringMatching(new RegExp(`.+\\${extension}$`)),
          mimeType: mimetype,
          extension,
          sizeBytes: BigInt(buffer.length),
          sha256:
            mimetype === 'application/pdf'
              ? '0716f9264c9fe19f5d7455276107f3ddcc1d3497f63d60689a73558ae8a1bf5e'
              : expect.stringMatching(/^[a-f0-9]{64}$/),
          category: 'PROPERTY_AFFAIR',
          uploadedBy: admin.id,
        },
      });
      expect(tx.propertyAffairFile.create).toHaveBeenCalledWith({
        data: { affairId: 41, fileAssetId: 71, createdBy: admin.id },
      });
      expect(tx.operationLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          module: 'PROPERTY_AFFAIRS',
          action: 'UPLOAD_FILE',
          entityType: 'PROPERTY_AFFAIR',
          entityId: 41,
          entityNo: 'WY202609020001',
          summary: `上传物业办事附件 WY202609020001：证明${extension}`,
          operatorId: admin.id,
          operatorRole: admin.role,
        }),
      });
      expect(writeFile).toHaveBeenCalledWith(
        expect.stringMatching(/[\\/]uploads[\\/]property-affairs[\\/][^\\/]+$/),
        buffer,
        { flag: 'wx' },
      );
    },
  );

  it('restores a UTF-8 filename decoded as Latin-1 by the multipart parser', async () => {
    const { service, tx } = uploadFixture();
    const buffer = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    const multipartName = Buffer.from('现场 照片.png', 'utf8').toString(
      'latin1',
    );

    const result = await save(service, 41, {
      originalname: multipartName,
      mimetype: 'image/png',
      size: buffer.length,
      buffer,
    });

    expect(result).toEqual(
      expect.objectContaining({ originalName: '现场 照片.png' }),
    );
    expect(tx.fileAsset.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ originalName: '现场 照片.png' }),
    });
  });

  it('rejects a visitor before affair, transaction, or physical-file work', async () => {
    const { service, db } = uploadFixture();
    const buffer = Buffer.from('%PDF-1.7\n');

    await expect(
      save(
        service,
        41,
        {
          originalname: '证明.pdf',
          mimetype: 'application/pdf',
          size: buffer.length,
          buffer,
        },
        visitor,
      ),
    ).rejects.toEqual(
      expect.objectContaining({ message: '无权操作物业办事附件', status: 403 }),
    );
    expect(db.propertyAffair.findFirst).not.toHaveBeenCalled();
    expect(db.$transaction).not.toHaveBeenCalled();
    expect(writeFile).not.toHaveBeenCalled();
  });

  it.each([
    ['missing', null],
    [
      'soft-deleted',
      { id: 41, affairNo: 'WY202609020001', deletedAt: new Date() },
    ],
  ])('rejects a %s affair before physical-file work', async (_case, affair) => {
    const { service, db } = uploadFixture({ affair });
    const buffer = Buffer.from('%PDF-1.7\n');

    await expect(
      save(service, 41, {
        originalname: '证明.pdf',
        mimetype: 'application/pdf',
        size: buffer.length,
        buffer,
      }),
    ).rejects.toEqual(
      expect.objectContaining({ message: '办事事项不存在', status: 404 }),
    );
    expect(db.$transaction).not.toHaveBeenCalled();
    expect(writeFile).not.toHaveBeenCalled();
  });

  it.each([
    [
      'absent buffer',
      { originalname: 'a.pdf', mimetype: 'application/pdf', size: 1 },
    ],
    [
      'absent original name',
      {
        mimetype: 'application/pdf',
        size: 9,
        buffer: Buffer.from('%PDF-1.7\n'),
      },
    ],
    [
      'MIME/extension mismatch',
      {
        originalname: 'a.jpg',
        mimetype: 'image/png',
        size: 8,
        buffer: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      },
    ],
    [
      'bad signature',
      {
        originalname: 'a.png',
        mimetype: 'image/png',
        size: 4,
        buffer: Buffer.from('nope'),
      },
    ],
    [
      'renamed executable',
      {
        originalname: 'evil.pdf',
        mimetype: 'application/pdf',
        size: 8,
        buffer: Buffer.from('MZ\u0090\u0000evil'),
      },
    ],
    [
      'legacy doc',
      {
        originalname: 'a.doc',
        mimetype: 'application/msword',
        size: 4,
        buffer: Buffer.from('PK\u0003\u0004'),
      },
    ],
    [
      'legacy xls',
      {
        originalname: 'a.xls',
        mimetype: 'application/vnd.ms-excel',
        size: 4,
        buffer: Buffer.from('PK\u0003\u0004'),
      },
    ],
  ])('rejects %s without writing a physical file', async (_case, file) => {
    const { service, db } = uploadFixture();

    await expect(save(service, 41, file)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(writeFile).not.toHaveBeenCalled();
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('rejects declared or actual content larger than the configured limit', async () => {
    const { service, db } = uploadFixture({ maxBytes: '8' });

    await expect(
      save(service, 41, {
        originalname: 'a.pdf',
        mimetype: 'application/pdf',
        size: 7,
        buffer: Buffer.from('%PDF-1234'),
      }),
    ).rejects.toThrow('附件超过允许大小');
    expect(writeFile).not.toHaveBeenCalled();
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('maps mkdir failure to a Chinese service error and compensates a possible path', async () => {
    const { service, db } = uploadFixture();
    jest
      .mocked(mkdir)
      .mockRejectedValue(
        Object.assign(new Error('denied'), { code: 'EACCES' }),
      );
    jest
      .mocked(unlink)
      .mockRejectedValue(
        Object.assign(new Error('missing'), { code: 'ENOENT' }),
      );
    const buffer = Buffer.from('%PDF-1.7\n');

    await expect(
      save(service, 41, {
        originalname: '证明.pdf',
        mimetype: 'application/pdf',
        size: buffer.length,
        buffer,
      }),
    ).rejects.toEqual(
      expect.objectContaining({
        message: '附件保存失败，请稍后重试',
        status: 503,
      }),
    );
    expect(writeFile).not.toHaveBeenCalled();
    expect(db.$transaction).not.toHaveBeenCalled();
    expect(unlink).toHaveBeenCalledTimes(1);
  });

  it('cleans a possibly partial file up to three times after write failure without masking the service error', async () => {
    const { service, db } = uploadFixture();
    const writeError = Object.assign(new Error('partial write'), {
      code: 'EIO',
    });
    const cleanupError = Object.assign(new Error('busy'), { code: 'EBUSY' });
    jest.mocked(writeFile).mockRejectedValue(writeError);
    jest
      .mocked(unlink)
      .mockRejectedValueOnce(cleanupError)
      .mockRejectedValueOnce(cleanupError)
      .mockResolvedValueOnce(undefined);
    const buffer = Buffer.from('%PDF-1.7\n');

    await expect(
      save(service, 41, {
        originalname: '证明.pdf',
        mimetype: 'application/pdf',
        size: buffer.length,
        buffer,
      }),
    ).rejects.toEqual(
      expect.objectContaining({
        message: '附件保存失败，请稍后重试',
        status: 503,
      }),
    );
    expect(db.$transaction).not.toHaveBeenCalled();
    expect(unlink).toHaveBeenCalledTimes(3);
  });

  it('rechecks the active affair in the link transaction and retries compensation three times', async () => {
    const { service, tx } = uploadFixture({ txAffair: null });
    const cleanupFailure = Object.assign(new Error('busy'), { code: 'EBUSY' });
    jest
      .mocked(unlink)
      .mockRejectedValueOnce(cleanupFailure)
      .mockRejectedValueOnce(cleanupFailure)
      .mockResolvedValueOnce(undefined);
    const buffer = Buffer.from('%PDF-1.7\n');

    await expect(
      save(service, 41, {
        originalname: '证明.pdf',
        mimetype: 'application/pdf',
        size: buffer.length,
        buffer,
      }),
    ).rejects.toEqual(
      expect.objectContaining({ message: '办事事项不存在', status: 404 }),
    );
    expect(tx.fileAsset.create).not.toHaveBeenCalled();
    expect(unlink).toHaveBeenCalledTimes(3);
  });

  it('retries physical compensation exactly three times when the link transaction fails', async () => {
    const transactionError = new Error('forced transaction failure');
    const { service } = uploadFixture({ transactionError });
    const loggerError = jest
      .spyOn(
        (service as unknown as { logger: { error: () => void } }).logger,
        'error',
      )
      .mockImplementation();
    jest
      .mocked(unlink)
      .mockRejectedValue(Object.assign(new Error('busy'), { code: 'EBUSY' }));
    const buffer = Buffer.from('%PDF-1.7\n');

    await expect(
      save(service, 41, {
        originalname: '证明.pdf',
        mimetype: 'application/pdf',
        size: buffer.length,
        buffer,
      }),
    ).rejects.toBe(transactionError);
    expect(unlink).toHaveBeenCalledTimes(3);
    expect(loggerError).toHaveBeenCalledWith(
      '物业办事附件物理文件补偿清理失败（错误代码：EBUSY）',
    );
  });

  function accessFixture(options?: {
    affair?: { id: number; affairNo: string; deletedAt: Date | null } | null;
    link?: Record<string, unknown> | null;
    transactionError?: Error;
    cleanupAsset?: Record<string, unknown> | null;
    deleteCount?: number;
    deleteError?: Error;
    sharedPhysical?: number;
  }) {
    const affair =
      options && 'affair' in options
        ? options.affair
        : { id: 41, affairNo: 'WY202609020001', deletedAt: null };
    const fileAsset = {
      id: 71,
      storageKey: 'property-affairs/stored.pdf',
      storedName: 'stored.pdf',
      originalName: '维修单.pdf',
      mimeType: 'application/pdf',
      extension: '.pdf',
      sizeBytes: 9n,
      sha256: 'a'.repeat(64),
      category: 'PROPERTY_AFFAIR',
      uploadedBy: admin.id,
      uploadedAt,
      lockedAt: null,
    };
    const link =
      options && 'link' in options
        ? options.link
        : { affairId: 41, fileAssetId: 71, createdAt: uploadedAt, fileAsset };
    const fileAssetDelegate = {
      findUnique: jest
        .fn()
        .mockResolvedValue(
          options && 'cleanupAsset' in options
            ? options.cleanupAsset
            : fileAsset,
        ),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      count: jest.fn().mockResolvedValue(options?.sharedPhysical ?? 0),
      deleteMany: jest
        .fn()
        .mockImplementation(() =>
          options?.deleteError
            ? Promise.reject(options.deleteError)
            : Promise.resolve({ count: options?.deleteCount ?? 1 }),
        ),
    };
    const tx = {
      propertyAffair: { findFirst: jest.fn().mockResolvedValue(affair) },
      propertyAffairFile: {
        findFirst: jest.fn().mockResolvedValue(link),
        deleteMany: jest.fn().mockResolvedValue({ count: link ? 1 : 0 }),
      },
      fileAsset: fileAssetDelegate,
      operationLog: { create: jest.fn().mockResolvedValue({ id: 1 }) },
    };
    const transactionCommit = jest.fn();
    const db = {
      propertyAffair: { findFirst: jest.fn().mockResolvedValue(affair) },
      propertyAffairFile: {
        findMany: jest.fn().mockResolvedValue(link ? [link] : []),
        findFirst: jest.fn().mockResolvedValue(link),
      },
      fileAsset: fileAssetDelegate,
      $transaction: jest
        .fn()
        .mockImplementation(
          async (callback: (client: typeof tx) => Promise<unknown>) => {
            if (options?.transactionError) throw options.transactionError;
            const result = await callback(tx);
            transactionCommit();
            return result;
          },
        ),
    };
    return {
      service: new FilesService({ db } as never, {} as never),
      db,
      tx,
      fileAsset,
      transactionCommit,
    };
  }

  function propertyMethods(service: FilesService) {
    return service as unknown as {
      listPropertyAffairFiles: (affairId: number) => Promise<unknown>;
      readPropertyAffairFile: (
        affairId: number,
        fileId: number,
      ) => Promise<{ asset: Record<string, unknown>; content: Buffer }>;
      unlinkPropertyAffairFile: (
        affairId: number,
        fileId: number,
        user: typeof admin,
      ) => Promise<unknown>;
      cleanupReleasedPropertyAffairFiles: (
        fileIds: number[],
      ) => Promise<unknown>;
    };
  }

  it('lists only category-matching joins newest first as JSON-safe summaries', async () => {
    const { service, db } = accessFixture();

    const result = await propertyMethods(service).listPropertyAffairFiles(41);

    expect(result).toEqual([
      {
        id: 71,
        originalName: '维修单.pdf',
        mimeType: 'application/pdf',
        sizeBytes: '9',
        uploadedAt,
      },
    ]);
    expect(() => JSON.stringify(result)).not.toThrow();
    expect(db.propertyAffairFile.findMany).toHaveBeenCalledWith({
      where: {
        affairId: 41,
        affair: { deletedAt: null },
        fileAsset: { category: 'PROPERTY_AFFAIR' },
      },
      include: { fileAsset: true },
      orderBy: [{ createdAt: 'desc' }, { fileAssetId: 'desc' }],
    });
  });

  it('reads only the requested affair join and confines a hostile stored name to the property folder', async () => {
    const fixture = accessFixture();
    const hostileLink = {
      affairId: 41,
      fileAssetId: 71,
      createdAt: uploadedAt,
      fileAsset: {
        ...fixture.fileAsset,
        storedName: '..\\..\\outside.pdf',
        storageKey: 'property-affairs/outside.pdf',
      },
    };
    fixture.db.propertyAffairFile.findFirst.mockResolvedValue(hostileLink);
    jest.mocked(readFile).mockResolvedValue(Buffer.from('preview'));

    const result = await propertyMethods(
      fixture.service,
    ).readPropertyAffairFile(41, 71);

    expect(fixture.db.propertyAffairFile.findFirst).toHaveBeenCalledWith({
      where: {
        affairId: 41,
        fileAssetId: 71,
        affair: { deletedAt: null },
        fileAsset: { category: 'PROPERTY_AFFAIR' },
      },
      include: { fileAsset: true },
    });
    expect(readFile).toHaveBeenCalledWith(
      expect.stringMatching(
        /[\\/]uploads[\\/]property-affairs[\\/]outside\.pdf$/,
      ),
    );
    expect(result).toEqual({
      asset: hostileLink.fileAsset,
      content: Buffer.from('preview'),
    });
  });

  it('makes a cross-affair file ID look nonexistent without touching disk', async () => {
    const { service, db } = accessFixture({ link: null });

    await expect(
      propertyMethods(service).readPropertyAffairFile(41, 99),
    ).rejects.toEqual(
      expect.objectContaining({ message: '物业办事附件不存在', status: 404 }),
    );
    expect(db.propertyAffairFile.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ affairId: 41, fileAssetId: 99 }),
      }),
    );
    expect(readFile).not.toHaveBeenCalled();
  });

  it.each([
    ['listPropertyAffairFiles', null],
    ['readPropertyAffairFile', null],
    [
      'listPropertyAffairFiles',
      {
        id: 41,
        affairNo: 'WY202609020001',
        deletedAt: new Date(),
      },
    ],
    [
      'readPropertyAffairFile',
      {
        id: 41,
        affairNo: 'WY202609020001',
        deletedAt: new Date(),
      },
    ],
  ] as const)(
    'rejects a missing or soft-deleted affair before %s file lookup',
    async (method, affair) => {
      const { service, db } = accessFixture({ affair });

      await expect(
        method === 'listPropertyAffairFiles'
          ? propertyMethods(service)[method](41)
          : propertyMethods(service)[method](41, 71),
      ).rejects.toEqual(
        expect.objectContaining({ message: '办事事项不存在', status: 404 }),
      );
      expect(db.propertyAffairFile.findMany).not.toHaveBeenCalled();
      expect(db.propertyAffairFile.findFirst).not.toHaveBeenCalled();
    },
  );

  it('unlinks and audits in a transaction before cleaning the released asset', async () => {
    const { service, tx, transactionCommit } = accessFixture();

    const result = await propertyMethods(service).unlinkPropertyAffairFile(
      41,
      71,
      admin,
    );

    expect(result).toEqual({ id: 71 });
    expect(tx.propertyAffair.findFirst).toHaveBeenCalledWith({
      where: { id: 41, deletedAt: null },
      select: { id: true, affairNo: true, deletedAt: true },
    });
    expect(tx.propertyAffairFile.findFirst).toHaveBeenCalledWith({
      where: {
        affairId: 41,
        fileAssetId: 71,
        affair: { deletedAt: null },
        fileAsset: { category: 'PROPERTY_AFFAIR' },
      },
      include: { fileAsset: true },
    });
    expect(tx.propertyAffairFile.deleteMany).toHaveBeenCalledWith({
      where: {
        affairId: 41,
        fileAssetId: 71,
        affair: { deletedAt: null },
        fileAsset: { category: 'PROPERTY_AFFAIR' },
      },
    });
    expect(tx.operationLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        module: 'PROPERTY_AFFAIRS',
        action: 'UNLINK_FILE',
        entityType: 'PROPERTY_AFFAIR',
        entityId: 41,
        entityNo: 'WY202609020001',
        summary: '移除物业办事附件 WY202609020001：维修单.pdf',
        operatorId: admin.id,
        operatorRole: admin.role,
      }),
    });
    expect(tx.fileAsset.deleteMany.mock.invocationCallOrder[0]).toBeLessThan(
      transactionCommit.mock.invocationCallOrder[1],
    );
    expect(transactionCommit.mock.invocationCallOrder[1]).toBeLessThan(
      unlink.mock.invocationCallOrder[0],
    );
  });

  it('rejects visitor unlink before transaction and physical cleanup', async () => {
    const { service, db } = accessFixture();

    await expect(
      propertyMethods(service).unlinkPropertyAffairFile(41, 71, visitor),
    ).rejects.toEqual(
      expect.objectContaining({ message: '无权操作物业办事附件', status: 403 }),
    );
    expect(db.$transaction).not.toHaveBeenCalled();
    expect(db.fileAsset.findUnique).not.toHaveBeenCalled();
    expect(unlink).not.toHaveBeenCalled();
  });

  it('makes a cross-affair unlink ID look nonexistent and leaves its asset untouched', async () => {
    const { service, db, tx } = accessFixture({ link: null });

    await expect(
      propertyMethods(service).unlinkPropertyAffairFile(41, 99, admin),
    ).rejects.toEqual(
      expect.objectContaining({ message: '物业办事附件不存在', status: 404 }),
    );
    expect(tx.propertyAffairFile.deleteMany).not.toHaveBeenCalled();
    expect(tx.operationLog.create).not.toHaveBeenCalled();
    expect(db.fileAsset.findUnique).not.toHaveBeenCalled();
    expect(unlink).not.toHaveBeenCalled();
  });

  it('does not start physical cleanup when the unlink transaction fails', async () => {
    const transactionError = new Error('forced unlink transaction failure');
    const { service, db } = accessFixture({ transactionError });

    await expect(
      propertyMethods(service).unlinkPropertyAffairFile(41, 71, admin),
    ).rejects.toBe(transactionError);
    expect(db.fileAsset.findUnique).not.toHaveBeenCalled();
    expect(unlink).not.toHaveBeenCalled();
  });

  it('returns the common 404 when concurrent soft deletion defeats the protected unlink delete', async () => {
    const { service, db, tx } = accessFixture();
    tx.propertyAffairFile.deleteMany.mockResolvedValue({ count: 0 });

    await expect(
      propertyMethods(service).unlinkPropertyAffairFile(41, 71, admin),
    ).rejects.toEqual(
      expect.objectContaining({ message: '物业办事附件不存在', status: 404 }),
    );
    expect(tx.propertyAffairFile.deleteMany).toHaveBeenCalledWith({
      where: {
        affairId: 41,
        fileAssetId: 71,
        affair: { deletedAt: null },
        fileAsset: { category: 'PROPERTY_AFFAIR' },
      },
    });
    expect(tx.operationLog.create).not.toHaveBeenCalled();
    expect(db.fileAsset.deleteMany).not.toHaveBeenCalled();
    expect(unlink).not.toHaveBeenCalled();
  });

  it('rejects unlinking from a soft-deleted affair before touching its join', async () => {
    const affair = {
      id: 41,
      affairNo: 'WY202609020001',
      deletedAt: new Date(),
    };
    const { service, db, tx } = accessFixture({ affair });

    await expect(
      propertyMethods(service).unlinkPropertyAffairFile(41, 71, admin),
    ).rejects.toEqual(
      expect.objectContaining({ message: '办事事项不存在', status: 404 }),
    );
    expect(tx.propertyAffairFile.findFirst).not.toHaveBeenCalled();
    expect(tx.propertyAffairFile.deleteMany).not.toHaveBeenCalled();
    expect(db.fileAsset.findUnique).not.toHaveBeenCalled();
  });

  it('deduplicates released IDs and treats missing assets as idempotent', async () => {
    const { service, db } = accessFixture({ cleanupAsset: null });

    const result = await propertyMethods(
      service,
    ).cleanupReleasedPropertyAffairFiles([71, 71, 72]);

    expect(result).toEqual({ deletedFileIds: [] });
    expect(db.fileAsset.findUnique).toHaveBeenCalledTimes(2);
    expect(db.fileAsset.findUnique).toHaveBeenNthCalledWith(1, {
      where: { id: 71 },
      select: expect.any(Object),
    });
    expect(db.fileAsset.findUnique).toHaveBeenNthCalledWith(2, {
      where: { id: 72 },
      select: expect.any(Object),
    });
    expect(unlink).not.toHaveBeenCalled();
    expect(db.fileAsset.deleteMany).not.toHaveBeenCalled();
  });

  it.each([
    [
      'another category',
      {
        id: 71,
        category: 'CONTRACT',
        storageKey: 'property-affairs/stored.pdf',
        storedName: 'stored.pdf',
        lockedAt: null,
      },
    ],
    [
      'an out-of-folder storage key',
      {
        id: 71,
        category: 'PROPERTY_AFFAIR',
        storageKey: 'contract-files/stored.pdf',
        storedName: 'stored.pdf',
        lockedAt: null,
      },
    ],
    [
      'a non-basename storage key',
      {
        id: 71,
        category: 'PROPERTY_AFFAIR',
        storageKey: 'property-affairs/subdir/stored.pdf',
        storedName: 'stored.pdf',
        lockedAt: null,
      },
    ],
  ])('never deletes %s candidate', async (_case, cleanupAsset) => {
    const { service, db } = accessFixture({ cleanupAsset });

    await propertyMethods(service).cleanupReleasedPropertyAffairFiles([71]);

    expect(db.fileAsset.updateMany).not.toHaveBeenCalled();
    expect(unlink).not.toHaveBeenCalled();
    expect(db.fileAsset.deleteMany).not.toHaveBeenCalled();
  });

  const allReferenceFilters = {
    tenantFiles: { none: {} },
    pricingRebateFiles: { none: {} },
    depositRefundFiles: { none: {} },
    checkoutSettlementItemFiles: { none: {} },
    paymentFiles: { none: {} },
    contractFiles: { none: {} },
    exportTasks: { none: {} },
    propertyAffairFiles: { none: {} },
    contractVoidRequestFiles: { none: {} },
  };

  it('deletes metadata with every relation guard in one transaction before physical cleanup', async () => {
    const { service, db, tx, transactionCommit } = accessFixture();

    const result = await propertyMethods(
      service,
    ).cleanupReleasedPropertyAffairFiles([71]);

    expect(result).toEqual({ deletedFileIds: [71] });
    expect(tx.fileAsset.findUnique).toHaveBeenCalledWith({
      where: { id: 71 },
      select: {
        id: true,
        category: true,
        storageKey: true,
        storedName: true,
      },
    });
    expect(tx.fileAsset.deleteMany).toHaveBeenCalledWith({
      where: {
        id: 71,
        category: 'PROPERTY_AFFAIR',
        storageKey: 'property-affairs/stored.pdf',
        storedName: 'stored.pdf',
        ...allReferenceFilters,
      },
    });
    expect(tx.fileAsset.updateMany).not.toHaveBeenCalled();
    expect(tx.fileAsset.deleteMany.mock.invocationCallOrder[0]).toBeLessThan(
      transactionCommit.mock.invocationCallOrder[0],
    );
    expect(transactionCommit.mock.invocationCallOrder[0]).toBeLessThan(
      unlink.mock.invocationCallOrder[0],
    );
    expect(db.$transaction).toHaveBeenCalledTimes(1);
  });

  it.each([
    'tenantFiles',
    'pricingRebateFiles',
    'depositRefundFiles',
    'checkoutSettlementItemFiles',
    'paymentFiles',
    'contractFiles',
    'exportTasks',
    'contractVoidRequestFiles',
  ] as const)(
    'does not delete metadata or physical content when %s gains a reference',
    async (relationName) => {
      const { service, tx } = accessFixture();
      tx.fileAsset.deleteMany.mockImplementation(({ where }) =>
        Promise.resolve({
          count:
            JSON.stringify((where as Record<string, unknown>)[relationName]) ===
            JSON.stringify(allReferenceFilters[relationName])
              ? 0
              : 1,
        }),
      );

      const result = await propertyMethods(
        service,
      ).cleanupReleasedPropertyAffairFiles([71]);

      expect(result).toEqual({ deletedFileIds: [] });
      expect(tx.fileAsset.deleteMany).toHaveBeenCalledWith({
        where: expect.objectContaining({
          [relationName]: { none: {} },
        }),
      });
      expect(tx.fileAsset.updateMany).not.toHaveBeenCalled();
      expect(unlink).not.toHaveBeenCalled();
    },
  );

  it('keeps metadata unlocked and supports retry when guarded delete returns count zero', async () => {
    const { service, tx } = accessFixture();
    tx.fileAsset.deleteMany
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 1 });

    await expect(
      propertyMethods(service).cleanupReleasedPropertyAffairFiles([71]),
    ).resolves.toEqual({ deletedFileIds: [] });
    expect(unlink).not.toHaveBeenCalled();
    expect(tx.fileAsset.updateMany).not.toHaveBeenCalled();

    await expect(
      propertyMethods(service).cleanupReleasedPropertyAffairFiles([71]),
    ).resolves.toEqual({ deletedFileIds: [71] });
    expect(tx.fileAsset.deleteMany).toHaveBeenCalledTimes(2);
    expect(unlink).toHaveBeenCalledTimes(1);
  });

  it('does not touch physical content after a database error and supports retry', async () => {
    const { service, tx } = accessFixture();
    const databaseError = new Error('forced metadata delete failure');
    tx.fileAsset.deleteMany
      .mockRejectedValueOnce(databaseError)
      .mockResolvedValueOnce({ count: 1 });

    await expect(
      propertyMethods(service).cleanupReleasedPropertyAffairFiles([71]),
    ).rejects.toBe(databaseError);
    expect(unlink).not.toHaveBeenCalled();
    expect(tx.fileAsset.updateMany).not.toHaveBeenCalled();

    await expect(
      propertyMethods(service).cleanupReleasedPropertyAffairFiles([71]),
    ).resolves.toEqual({ deletedFileIds: [71] });
    expect(unlink).toHaveBeenCalledTimes(1);
  });

  it('retains a shared physical file while deleting only the unreferenced candidate row', async () => {
    const { service, db } = accessFixture({ sharedPhysical: 1 });

    const result = await propertyMethods(
      service,
    ).cleanupReleasedPropertyAffairFiles([71]);

    expect(result).toEqual({ deletedFileIds: [71] });
    expect(unlink).not.toHaveBeenCalled();
    expect(db.fileAsset.deleteMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: 71,
        category: 'PROPERTY_AFFAIR',
        propertyAffairFiles: { none: {} },
      }),
    });
  });

  it('treats a missing physical file as idempotent and still removes its unreferenced asset row', async () => {
    const { service, db } = accessFixture();
    jest
      .mocked(unlink)
      .mockRejectedValue(
        Object.assign(new Error('missing'), { code: 'ENOENT' }),
      );

    const result = await propertyMethods(
      service,
    ).cleanupReleasedPropertyAffairFiles([71]);

    expect(result).toEqual({ deletedFileIds: [71] });
    expect(unlink).toHaveBeenCalledWith(
      expect.stringMatching(
        /[\\/]uploads[\\/]property-affairs[\\/]stored\.pdf$/,
      ),
    );
    expect(db.fileAsset.deleteMany).toHaveBeenCalledTimes(1);
    expect(db.fileAsset.deleteMany.mock.invocationCallOrder[0]).toBeLessThan(
      unlink.mock.invocationCallOrder[0],
    );
  });

  it('retries physical cleanup three times after committed metadata deletion and logs without a path', async () => {
    const { service, db, transactionCommit } = accessFixture();
    const loggerError = jest
      .spyOn(
        (service as unknown as { logger: { error: () => void } }).logger,
        'error',
      )
      .mockImplementation();
    jest
      .mocked(unlink)
      .mockRejectedValue(Object.assign(new Error('busy'), { code: 'EBUSY' }));

    await expect(
      propertyMethods(service).cleanupReleasedPropertyAffairFiles([71]),
    ).resolves.toEqual({ deletedFileIds: [71] });
    expect(db.fileAsset.deleteMany).toHaveBeenCalledTimes(1);
    expect(transactionCommit.mock.invocationCallOrder[0]).toBeLessThan(
      unlink.mock.invocationCallOrder[0],
    );
    expect(unlink).toHaveBeenCalledTimes(3);
    expect(db.fileAsset.updateMany).not.toHaveBeenCalled();
    expect(loggerError).toHaveBeenCalledWith(
      '物业办事附件物理文件清理失败（错误代码：EBUSY）',
    );
    expect(loggerError.mock.calls.flat().join(' ')).not.toContain('stored.pdf');
  });
});
