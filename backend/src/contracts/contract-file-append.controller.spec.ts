import { PATH_METADATA } from '@nestjs/common/constants';
import { UserRole } from '@prisma/client';
import type { AuthUser } from '../auth/auth-user.type';
import { ROLES_KEY } from '../authorization/roles.decorator';
import { ContractsController } from './contracts.controller';

describe('ContractsController append file', () => {
  it('registers an admin-only append route and delegates the linked upload', async () => {
    const prototype = ContractsController.prototype as unknown as Record<
      string,
      object | undefined
    >;
    const append = prototype.appendFile;
    expect(append).toBeDefined();
    if (!append) return;
    expect(Reflect.getMetadata(PATH_METADATA, append)).toBe(':id/files');
    expect(Reflect.getMetadata(ROLES_KEY, append)).toEqual([
      UserRole.SUPER_ADMIN,
      UserRole.ADMIN,
    ]);

    const saved = { id: 41, originalName: '补充合同.pdf' };
    const saveAndLinkContractFile = jest.fn().mockResolvedValue(saved);
    const controller = Reflect.construct(ContractsController, [
      {},
      {},
      { saveAndLinkContractFile },
      {},
    ]) as ContractsController;
    const file = {
      originalname: '补充合同.pdf',
      mimetype: 'application/pdf',
      size: 9,
      buffer: Buffer.from('%PDF-1.7'),
    };
    const user: AuthUser = {
      id: 7,
      username: 'admin',
      displayName: '管理员',
      role: UserRole.ADMIN,
    };

    await expect(
      (
        controller as never as {
          appendFile: (
            id: number,
            file: typeof file,
            user: AuthUser,
          ) => Promise<unknown>;
        }
      ).appendFile(12, file, user),
    ).resolves.toEqual({
      code: 200,
      message: 'success',
      data: saved,
    });
    expect(saveAndLinkContractFile).toHaveBeenCalledWith(12, file, user);
  });
});
