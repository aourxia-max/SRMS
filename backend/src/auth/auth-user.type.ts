import { UserRole } from '@prisma/client';

export type AuthUser = {
  id: number;
  username: string;
  displayName: string;
  role: UserRole;
};

export type AccessTokenPayload = AuthUser & {
  sub: number;
  tokenType: 'access';
};
export type RefreshTokenPayload = { sub: number; tokenType: 'refresh' };
