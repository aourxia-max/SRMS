import { ForbiddenException } from '@nestjs/common';
import { INTERCEPTORS_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { UserRole } from '@prisma/client';
import type { AuthUser } from '../auth/auth-user.type';
import { ROLES_KEY } from '../authorization/roles.decorator';
import { ContractsController } from './contracts.controller';
import type { CreateFixedContractDto } from './dto/create-fixed-contract.dto';

const admin: AuthUser = {
  id: 7,
  username: 'admin',
  displayName: 'Admin',
  role: UserRole.ADMIN,
};

describe('ContractsController', () => {
  function controllerWith(
    contracts: Record<string, jest.Mock> = {},
    files: Record<string, jest.Mock> = {},
  ) {
    return Reflect.construct(ContractsController, [
      contracts,
      {},
      files,
    ]) as ContractsController;
  }

  it('rejects commission data from an admin before creating a fixed contract', async () => {
    const createFixedContract = jest.fn();
    const controller = controllerWith({ createFixedContract });
    const createFixed = controller.createFixed as unknown as (
      dto: CreateFixedContractDto,
      user: AuthUser,
    ) => Promise<unknown>;

    await expect(
      createFixed(
        {
          roomId: 1,
          startDate: '2026-08-05',
          endDate: '2027-08-04',
          monthlyRent: '3000',
          primaryTenantId: 2,
          commission: { recipientName: 'Broker', amount: '500' },
        },
        admin,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(createFixedContract).not.toHaveBeenCalled();
  });

  it('registers the exact contract attachment routes and role policies', () => {
    const prototype = ContractsController.prototype as unknown as Record<
      string,
      object | undefined
    >;
    const upload = prototype.uploadFile;
    const list = prototype.files;
    const download = prototype.downloadFile;

    expect(upload).toBeDefined();
    expect(list).toBeDefined();
    expect(download).toBeDefined();
    if (!upload || !list || !download) return;

    expect(Reflect.getMetadata(PATH_METADATA, upload)).toBe('files');
    expect(Reflect.getMetadata(PATH_METADATA, list)).toBe(':id/files');
    expect(Reflect.getMetadata(PATH_METADATA, download)).toBe(
      ':id/files/:fileId/download',
    );
    expect(Reflect.getMetadata(ROLES_KEY, upload)).toEqual([
      UserRole.SUPER_ADMIN,
      UserRole.ADMIN,
    ]);
    expect(Reflect.getMetadata(ROLES_KEY, download)).toEqual([
      UserRole.SUPER_ADMIN,
      UserRole.ADMIN,
      UserRole.VISITOR,
    ]);
    const [UploadInterceptor] = Reflect.getMetadata(
      INTERCEPTORS_METADATA,
      upload,
    ) as Array<new () => { multer: { limits?: { fileSize?: number } } }>;
    const uploadInterceptor = new UploadInterceptor();
    expect(uploadInterceptor.multer.limits?.fileSize).toBe(100 * 1024 * 1024);
  });

  it('uploads a contract file through the file service without returning contract data', async () => {
    const saved = {
      id: 41,
      originalName: 'signed-contract.pdf',
      mimeType: 'application/pdf',
      sizeBytes: '9',
    };
    const saveContractFile = jest.fn().mockResolvedValue(saved);
    const controller = controllerWith({}, { saveContractFile });
    const uploadFile = (
      controller as unknown as {
        uploadFile: (
          file: {
            originalname: string;
            mimetype: string;
            size: number;
            buffer: Buffer;
          },
          user: AuthUser,
        ) => Promise<unknown>;
      }
    ).uploadFile;
    expect(uploadFile).toBeDefined();
    if (!uploadFile) return;
    const file = {
      originalname: 'signed-contract.pdf',
      mimetype: 'application/pdf',
      size: 9,
      buffer: Buffer.from('%PDF-1.7'),
    };

    await expect(uploadFile.call(controller, file, admin)).resolves.toEqual({
      code: 200,
      message: 'success',
      data: saved,
    });
    expect(saveContractFile).toHaveBeenCalledWith(file, admin);
  });

  it('lists contract files through the file service', async () => {
    const fileList = [{ id: 41, originalName: 'signed-contract.pdf' }];
    const listContractFiles = jest.fn().mockResolvedValue(fileList);
    const controller = controllerWith({}, { listContractFiles });
    const files = (
      controller as unknown as {
        files: (contractId: number) => Promise<unknown>;
      }
    ).files;
    expect(files).toBeDefined();
    if (!files) return;

    await expect(files.call(controller, 12)).resolves.toEqual({
      code: 200,
      message: 'success',
      data: fileList,
    });
    expect(listContractFiles).toHaveBeenCalledWith(12);
  });

  it('downloads a linked contract file with safe content headers', async () => {
    const downloadContractFile = jest.fn().mockResolvedValue({
      asset: {
        originalName: '签约合同.pdf',
        mimeType: 'application/pdf',
      },
      content: Buffer.from('contract'),
    });
    const response = {
      setHeader: jest.fn(),
      send: jest.fn(),
    };
    const controller = controllerWith({}, { downloadContractFile });
    const downloadFile = (
      controller as unknown as {
        downloadFile: (
          contractId: number,
          fileId: number,
          response: typeof response,
        ) => Promise<void>;
      }
    ).downloadFile;
    expect(downloadFile).toBeDefined();
    if (!downloadFile) return;

    await downloadFile.call(controller, 12, 41, response);

    expect(downloadContractFile).toHaveBeenCalledWith(12, 41);
    expect(response.setHeader).toHaveBeenCalledWith(
      'Content-Type',
      'application/pdf',
    );
    expect(response.setHeader).toHaveBeenCalledWith(
      'Content-Disposition',
      "attachment; filename*=UTF-8''%E7%AD%BE%E7%BA%A6%E5%90%88%E5%90%8C.pdf",
    );
    expect(response.send).toHaveBeenCalledWith(Buffer.from('contract'));
  });
});
