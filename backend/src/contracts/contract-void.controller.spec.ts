import { PATH_METADATA } from '@nestjs/common/constants';
import { UserRole } from '@prisma/client';
import { ROLES_KEY } from '../authorization/roles.decorator';
import { ContractVoidController } from './contract-void.controller';

const admin = {
  id: 2,
  username: 'admin',
  displayName: '\u7ba1\u7406\u5458',
  role: UserRole.ADMIN,
};

describe('ContractVoidController', () => {
  it('excludes visitors from preview/create and admins from rejection', () => {
    const prototype = ContractVoidController.prototype as unknown as Record<
      string,
      object
    >;

    expect(Reflect.getMetadata(PATH_METADATA, prototype.preview)).toBe(
      ':id/void-preview',
    );
    expect(Reflect.getMetadata(ROLES_KEY, prototype.preview)).toEqual([
      UserRole.SUPER_ADMIN,
      UserRole.ADMIN,
    ]);
    expect(Reflect.getMetadata(ROLES_KEY, prototype.submit)).toEqual([
      UserRole.SUPER_ADMIN,
      UserRole.ADMIN,
    ]);
    expect(Reflect.getMetadata(ROLES_KEY, prototype.reject)).toEqual([
      UserRole.SUPER_ADMIN,
    ]);
  });

  it('wraps request and preview results in the standard envelope', async () => {
    const requests = {
      list: jest.fn().mockResolvedValue([{ id: 9 }]),
      submit: jest.fn().mockResolvedValue({ id: 9 }),
    };
    const previews = {
      preview: jest.fn().mockResolvedValue({ impactHash: 'a' }),
    };
    const controller = Reflect.construct(ContractVoidController, [
      requests,
      previews,
      {},
    ]) as ContractVoidController;

    await expect(controller.list({}, admin)).resolves.toEqual({
      code: 200,
      message: 'success',
      data: [{ id: 9 }],
    });
    await expect(
      controller.submit(
        {
          contractId: 7,
          reason: '\u5f55\u5165\u9519\u8bef',
          impactHash: 'a'.repeat(64),
          idempotencyKey: 'submit-contract-void-0001',
        },
        admin,
      ),
    ).resolves.toEqual({
      code: 200,
      message: 'success',
      data: { id: 9 },
    });
    await expect(controller.preview(7, admin)).resolves.toEqual({
      code: 200,
      message: 'success',
      data: { impactHash: 'a' },
    });
  });
});
