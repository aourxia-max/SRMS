import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { RolesGuard } from './roles.guard';

describe('RolesGuard', () => {
  const reflector = { getAllAndOverride: jest.fn() } as unknown as Reflector;
  const guard = new RolesGuard(reflector);
  const context = (role?: UserRole) =>
    ({
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: () => ({
        getRequest: () => ({ user: role ? { role } : undefined }),
      }),
    }) as unknown as ExecutionContext;

  it('allows a super administrator to enter a super-administrator endpoint', () => {
    jest
      .mocked(reflector.getAllAndOverride)
      .mockReturnValue([UserRole.SUPER_ADMIN]);
    expect(guard.canActivate(context(UserRole.SUPER_ADMIN))).toBe(true);
  });

  it('rejects an administrator or missing session for a super-administrator endpoint', () => {
    jest
      .mocked(reflector.getAllAndOverride)
      .mockReturnValue([UserRole.SUPER_ADMIN]);
    expect(() => guard.canActivate(context(UserRole.ADMIN))).toThrow(
      ForbiddenException,
    );
    expect(() => guard.canActivate(context())).toThrow(ForbiddenException);
  });
});
