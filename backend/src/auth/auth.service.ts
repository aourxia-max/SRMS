import {
  Injectable,
  HttpException,
  HttpStatus,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { Request } from 'express';
import { User, UserRole, UserStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  AccessTokenPayload,
  AuthUser,
  RefreshTokenPayload,
} from './auth-user.type';
import { LoginDto } from './dto/login.dto';

const MAX_FAILED_LOGINS = 5;
const LOCK_DURATION_MS = 15 * 60 * 1000;

type SessionResult = {
  accessToken: string;
  refreshToken: string;
  user: AuthUser;
};

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async bootstrapInitialSuperAdmin() {
    const db = this.prisma.db;
    if ((await db.user.count()) !== 0) return;
    const username = this.config.get<string>('INITIAL_SUPER_ADMIN_USERNAME');
    const displayName = this.config.get<string>(
      'INITIAL_SUPER_ADMIN_DISPLAY_NAME',
    );
    const password = this.config.get<string>('INITIAL_SUPER_ADMIN_PASSWORD');
    if (!username || !displayName || !password) return;

    await db.user.create({
      data: {
        username,
        displayName,
        passwordHash: await argon2.hash(password, { type: argon2.argon2id }),
        role: UserRole.SUPER_ADMIN,
        status: UserStatus.ACTIVE,
      },
    });
  }

  async login(dto: LoginDto, request: Request): Promise<SessionResult> {
    const db = this.prisma.db;
    const user = await db.user.findUnique({
      where: { username: dto.username },
    });
    if (!user || user.deletedAt || user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException('用户名或密码错误');
    }
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new HttpException('账户暂时锁定，请稍后重试', HttpStatus.LOCKED);
    }

    if (!(await argon2.verify(user.passwordHash, dto.password))) {
      const failures = user.failedLoginCount + 1;
      await db.user.update({
        where: { id: user.id },
        data: {
          failedLoginCount: failures,
          lockedUntil:
            failures >= MAX_FAILED_LOGINS
              ? new Date(Date.now() + LOCK_DURATION_MS)
              : null,
        },
      });
      throw new UnauthorizedException('用户名或密码错误');
    }

    const now = new Date();
    await db.user.update({
      where: { id: user.id },
      data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: now },
    });
    return this.createSession(user, request);
  }

  async refresh(refreshToken: string | undefined, request: Request) {
    if (!refreshToken) throw new UnauthorizedException('登录状态已失效');
    let payload: RefreshTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<RefreshTokenPayload>(refreshToken, {
        secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('登录状态已失效');
    }
    if (payload.tokenType !== 'refresh')
      throw new UnauthorizedException('登录状态已失效');

    const db = this.prisma.db;
    const tokens = await db.authRefreshToken.findMany({
      where: {
        userId: payload.sub,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      include: { user: true },
    });
    const stored = await this.findMatchingToken(tokens, refreshToken);
    if (
      !stored ||
      stored.user.deletedAt ||
      stored.user.status !== UserStatus.ACTIVE
    ) {
      throw new UnauthorizedException('登录状态已失效');
    }
    await db.authRefreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });
    return this.createSession(stored.user, request);
  }

  async logout(refreshToken: string | undefined) {
    if (!refreshToken) return;
    const tokens = await this.prisma.db.authRefreshToken.findMany({
      where: { revokedAt: null, expiresAt: { gt: new Date() } },
    });
    const stored = await this.findMatchingToken(tokens, refreshToken);
    if (stored) {
      await this.prisma.db.authRefreshToken.update({
        where: { id: stored.id },
        data: { revokedAt: new Date() },
      });
    }
  }

  async logoutAll(userId: number) {
    await this.prisma.db.authRefreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private async createSession(
    user: User,
    request: Request,
  ): Promise<SessionResult> {
    const authUser = this.toAuthUser(user);
    const accessToken = await this.jwt.signAsync<AccessTokenPayload>(
      { ...authUser, sub: user.id, tokenType: 'access' },
      {
        secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
        expiresIn: this.config.get<string>(
          'JWT_ACCESS_EXPIRES_IN',
          '15m',
        ) as never,
      },
    );
    const refreshToken = await this.jwt.signAsync<RefreshTokenPayload>(
      { sub: user.id, tokenType: 'refresh' },
      {
        secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
        expiresIn: this.config.get<string>(
          'JWT_REFRESH_EXPIRES_IN',
          '7d',
        ) as never,
      },
    );
    await this.prisma.db.authRefreshToken.create({
      data: {
        userId: user.id,
        tokenHash: await argon2.hash(refreshToken, { type: argon2.argon2id }),
        expiresAt: this.refreshExpiry(),
        ipAddress: request.ip,
        userAgent: request.get('user-agent')?.slice(0, 500),
      },
    });
    return { accessToken, refreshToken, user: authUser };
  }

  private refreshExpiry() {
    const value = this.config.get<string>('JWT_REFRESH_EXPIRES_IN', '7d');
    const match = /^(\d+)([dhm])$/.exec(value);
    const multiplier =
      match?.[2] === 'd' ? 86_400_000 : match?.[2] === 'h' ? 3_600_000 : 60_000;
    return new Date(Date.now() + Number(match?.[1] ?? 7) * multiplier);
  }

  private async findMatchingToken<T extends { tokenHash: string }>(
    tokens: T[],
    token: string,
  ) {
    for (const candidate of tokens)
      if (await argon2.verify(candidate.tokenHash, token)) return candidate;
    return undefined;
  }

  private toAuthUser(user: User): AuthUser {
    return {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      role: user.role,
    };
  }
}
