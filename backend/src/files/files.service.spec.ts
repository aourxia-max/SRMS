import { readFile } from 'fs/promises';
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
            : 'image/jpeg,image/png,image/webp',
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
