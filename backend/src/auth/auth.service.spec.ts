import * as argon2 from 'argon2';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { UserRole, UserStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from './auth.service';

jest.mock('argon2', () => ({
  argon2id: 2,
  hash: jest.fn().mockResolvedValue('hashed'),
  verify: jest.fn(),
}));

const user = {
  id: 1,
  username: 'root',
  displayName: '超级管理员',
  passwordHash: 'hashed-password',
  role: UserRole.SUPER_ADMIN,
  status: UserStatus.ACTIVE,
  failedLoginCount: 0,
  lockedUntil: null,
  lastLoginAt: null,
  deletedAt: null,
};

describe('AuthService', () => {
  let service: AuthService;
  let db: any;
  const config = {
    get: jest.fn(),
    getOrThrow: jest.fn(),
  } as unknown as ConfigService;
  const jwt = {
    signAsync: jest.fn(),
    verifyAsync: jest.fn(),
  } as unknown as JwtService;

  beforeEach(() => {
    db = {
      user: {
        count: jest.fn(),
        create: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      authRefreshToken: {
        create: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
    };
    jest
      .mocked(config.get)
      .mockImplementation((key: string, fallback?: string) => {
        const values: Record<string, string> = {
          INITIAL_SUPER_ADMIN_USERNAME: 'root',
          INITIAL_SUPER_ADMIN_DISPLAY_NAME: '超级管理员',
          INITIAL_SUPER_ADMIN_PASSWORD: 'secret',
          JWT_ACCESS_EXPIRES_IN: '15m',
          JWT_REFRESH_EXPIRES_IN: '7d',
        };
        return values[key] ?? fallback;
      });
    jest
      .mocked(config.getOrThrow)
      .mockImplementation((key: string) => `${key}-value`);
    service = new AuthService({ db } as PrismaService, jwt, config);
  });

  it('creates the initial super administrator once only', async () => {
    db.user.count.mockResolvedValueOnce(0).mockResolvedValueOnce(1);
    await service.bootstrapInitialSuperAdmin();
    await service.bootstrapInitialSuperAdmin();
    expect(db.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ role: UserRole.SUPER_ADMIN }),
      }),
    );
    expect(db.user.create).toHaveBeenCalledTimes(1);
  });

  it('logs in, clears failures, records last login, and creates a hashed refresh session', async () => {
    db.user.findUnique.mockResolvedValue(user);
    db.user.update.mockResolvedValue(user);
    db.authRefreshToken.create.mockResolvedValue({});
    jest.mocked(argon2.verify).mockResolvedValue(true);
    jest
      .mocked(jwt.signAsync)
      .mockResolvedValueOnce('access')
      .mockResolvedValueOnce('refresh');
    const result = await service.login(
      { username: 'root', password: 'secret' },
      { ip: '127.0.0.1', get: jest.fn() } as any,
    );
    expect(result).toMatchObject({
      accessToken: 'access',
      refreshToken: 'refresh',
      user: { username: 'root' },
    });
    expect(db.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ failedLoginCount: 0 }),
      }),
    );
    expect(db.authRefreshToken.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ tokenHash: 'hashed' }),
      }),
    );
  });

  it('increments failed logins and locks on the fifth failure', async () => {
    db.user.findUnique.mockResolvedValue({ ...user, failedLoginCount: 4 });
    jest.mocked(argon2.verify).mockResolvedValue(false);
    await expect(
      service.login({ username: 'root', password: 'bad' }, {} as any),
    ).rejects.toMatchObject({ status: 401 });
    expect(db.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          failedLoginCount: 5,
          lockedUntil: expect.any(Date),
        }),
      }),
    );
  });

  it('rotates refresh tokens and rejects their old value', async () => {
    jest
      .mocked(jwt.verifyAsync)
      .mockResolvedValue({ sub: 1, tokenType: 'refresh' });
    db.authRefreshToken.findMany.mockResolvedValue([
      { id: 8, tokenHash: 'stored', user },
    ]);
    db.authRefreshToken.update.mockResolvedValue({});
    db.authRefreshToken.create.mockResolvedValue({});
    jest.mocked(argon2.verify).mockResolvedValue(true);
    jest
      .mocked(jwt.signAsync)
      .mockResolvedValueOnce('access-2')
      .mockResolvedValueOnce('refresh-2');
    await expect(
      service.refresh('old-refresh', { get: jest.fn() } as any),
    ).resolves.toMatchObject({ accessToken: 'access-2' });
    expect(db.authRefreshToken.update).toHaveBeenCalledWith({
      where: { id: 8 },
      data: { revokedAt: expect.any(Date) },
    });
  });

  it('revokes current and all-device sessions', async () => {
    db.authRefreshToken.findMany.mockResolvedValue([
      { id: 8, tokenHash: 'stored' },
    ]);
    jest.mocked(argon2.verify).mockResolvedValue(true);
    await service.logout('refresh');
    await service.logoutAll(1);
    expect(db.authRefreshToken.update).toHaveBeenCalled();
    expect(db.authRefreshToken.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 1, revokedAt: null } }),
    );
  });
});
