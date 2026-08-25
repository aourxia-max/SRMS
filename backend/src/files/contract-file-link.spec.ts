import { UserRole } from '@prisma/client';
import { FilesService } from './files.service';

describe('FilesService append contract file', () => {
  it('uploads a new asset and links it to an existing contract without removing old links', async () => {
    const findUnique = jest.fn().mockResolvedValue({ id: 12 });
    const create = jest
      .fn()
      .mockResolvedValue({ contractId: 12, fileAssetId: 41 });
    const service = new FilesService(
      {
        db: {
          contract: { findUnique },
          contractFile: { create },
        },
      } as never,
      {} as never,
    );
    const asset = {
      id: 41,
      originalName: '补充合同.pdf',
      mimeType: 'application/pdf',
      sizeBytes: '9',
    };
    jest.spyOn(service, 'saveContractFile').mockResolvedValue(asset);
    const file = {
      originalname: '补充合同.pdf',
      mimetype: 'application/pdf',
      size: 9,
      buffer: Buffer.from('%PDF-1.7'),
    };
    const user = {
      id: 7,
      username: 'admin',
      displayName: '管理员',
      role: UserRole.ADMIN,
    };

    await expect(
      service.saveAndLinkContractFile(12, file, user),
    ).resolves.toEqual(asset);
    expect(findUnique).toHaveBeenCalledWith({
      where: { id: 12 },
      select: { id: true },
    });
    expect(create).toHaveBeenCalledWith({
      data: { contractId: 12, fileAssetId: 41 },
    });
  });
});
