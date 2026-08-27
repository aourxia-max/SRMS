import { readFile, unlink, writeFile } from 'fs/promises';
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
} from './files.service';

jest.mock('fs/promises', () => ({
  mkdir: jest.fn().mockResolvedValue(undefined),
  writeFile: jest.fn().mockResolvedValue(undefined),
  readFile: jest.fn(),
  unlink: jest.fn().mockResolvedValue(undefined),
}));

describe('FilesService payment proofs', () => {
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
    const before = Date.now() - CONTRACT_VOID_PROOF_STAGED_TTL_MS;
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

    const cutoff = findMany.mock.calls[0][0].where.uploadedAt.lt as Date;
    expect(cutoff.getTime()).toBeLessThanOrEqual(before);
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
