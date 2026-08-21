import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { ROLES_KEY } from '../authorization/roles.decorator';
import { TenantsController } from './tenants.controller';

describe('TenantsController.remove', () => {
  const user = {
    id: 7,
    username: 'admin',
    displayName: '管理员',
    role: UserRole.ADMIN,
  };

  it('暴露受管理员角色保护的删除接口并删除指定承租人', async () => {
    const tenants = { remove: jest.fn().mockResolvedValue({ id: 19 }) };
    const controller = new TenantsController(tenants as never, {} as never);

    const response = await controller.remove(19, user);

    expect(tenants.remove).toHaveBeenCalledWith(19, user);
    expect(response).toEqual({
      code: 200,
      message: 'success',
      data: { id: 19 },
    });
    expect(Reflect.getMetadata(PATH_METADATA, controller.remove)).toBe(':id');
    expect(Reflect.getMetadata(METHOD_METADATA, controller.remove)).toBe(
      RequestMethod.DELETE,
    );
    expect(Reflect.getMetadata(ROLES_KEY, controller.remove)).toEqual([
      UserRole.SUPER_ADMIN,
      UserRole.ADMIN,
    ]);
  });
});
