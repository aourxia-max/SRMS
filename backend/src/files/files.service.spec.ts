import { readFile, writeFile } from 'fs/promises';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { FilesService } from './files.service';

jest.mock('fs/promises', () => ({
  mkdir: jest.fn().mockResolvedValue(undefined),
  writeFile: jest.fn().mockResolvedValue(undefined),
  readFile: jest.fn(),
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
    const findMany = jest.fn().mockResolvedValue([
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
    ]);

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
  });

  it('downloads only an asset linked to the requested contract', async () => {
    jest.mocked(readFile).mockResolvedValue(Buffer.from('contract'));
    const findUnique = jest.fn().mockResolvedValue({
      contractId: 12,
      fileAssetId: 41,
      fileAsset: {
        id: 41,
        storedName: 'stored.pdf',
        originalName: 'signed-contract.pdf',
        mimeType: 'application/pdf',
      },
    });
    const service = serviceWith({ contractFile: { findUnique } });

    const result = await service.downloadContractFile(12, 41);

    expect(findUnique).toHaveBeenCalledWith({
      where: { contractId_fileAssetId: { contractId: 12, fileAssetId: 41 } },
      include: { fileAsset: true },
    });
    expect(result.content.toString()).toBe('contract');
    expect(result.asset.originalName).toBe('signed-contract.pdf');
  });

  it('rejects downloading an asset that is not linked to the requested contract', async () => {
    await expect(
      serviceWith({
        contractFile: { findUnique: jest.fn().mockResolvedValue(null) },
      }).downloadContractFile(12, 99),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
