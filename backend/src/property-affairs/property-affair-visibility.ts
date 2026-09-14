import {
  Prisma,
  PropertyAffairVisibilityScope,
  UserRole,
  UserStatus,
} from '@prisma/client';
import type { AuthUser } from '../auth/auth-user.type';

export function propertyAffairVisibilityWhere(
  user: AuthUser,
): Prisma.PropertyAffairWhereInput {
  if (user.role === UserRole.SUPER_ADMIN) return {};

  return {
    OR: [
      { visibilityScope: PropertyAffairVisibilityScope.ALL },
      { createdBy: user.id },
      {
        viewers: {
          some: { userId: user.id, user: { status: UserStatus.ACTIVE } },
        },
      },
    ],
  };
}

export function propertyAffairVisibilitySql(user: AuthUser): Prisma.Sql {
  if (user.role === UserRole.SUPER_ADMIN) return Prisma.sql`TRUE`;

  return Prisma.sql`
    (
      property_affairs.visibility_scope = 'ALL'
      OR property_affairs.created_by = ${user.id}
      OR EXISTS (
        SELECT 1
        FROM property_affair_viewers pav
        JOIN users u ON u.id = pav.user_id
        WHERE pav.affair_id = property_affairs.id
          AND pav.user_id = ${user.id}
          AND u.status = 'ACTIVE'
      )
    )
  `;
}
