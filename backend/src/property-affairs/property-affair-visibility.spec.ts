import {
  PropertyAffairVisibilityScope,
  UserRole,
  UserStatus,
} from '@prisma/client';
import type { AuthUser } from '../auth/auth-user.type';
import {
  propertyAffairVisibilitySql,
  propertyAffairVisibilityWhere,
} from './property-affair-visibility';

const user = (role: UserRole, id = 42): AuthUser => ({
  id,
  username: role.toLowerCase(),
  displayName: role,
  role,
});

const sqlStatement = (sql: { strings: readonly string[] }) =>
  sql.strings.join('?').replace(/\s+/g, ' ').trim();

describe('property-affair visibility policy', () => {
  it('leaves the Prisma condition unrestricted for a super admin', () => {
    expect(propertyAffairVisibilityWhere(user(UserRole.SUPER_ADMIN))).toEqual(
      {},
    );
  });

  it('matches ALL affairs, an admin creator, or an active explicit viewer in Prisma', () => {
    expect(propertyAffairVisibilityWhere(user(UserRole.ADMIN))).toEqual({
      OR: [
        { visibilityScope: PropertyAffairVisibilityScope.ALL },
        { createdBy: 42 },
        {
          viewers: {
            some: { userId: 42, user: { status: UserStatus.ACTIVE } },
          },
        },
      ],
    });
  });

  it('keeps every non-super-admin on the same policy without a visitor branch', () => {
    expect(propertyAffairVisibilityWhere(user(UserRole.VISITOR, 81))).toEqual({
      OR: [
        { visibilityScope: PropertyAffairVisibilityScope.ALL },
        { createdBy: 81 },
        {
          viewers: {
            some: { userId: 81, user: { status: UserStatus.ACTIVE } },
          },
        },
      ],
    });
  });

  it('uses a neutral SQL predicate for a super admin', () => {
    const sql = propertyAffairVisibilitySql(user(UserRole.SUPER_ADMIN));

    expect(sqlStatement(sql)).toBe('TRUE');
    expect(sql.values).toEqual([]);
  });

  it('uses the same three parameterized SQL visibility branches for an admin', () => {
    const sql = propertyAffairVisibilitySql(user(UserRole.ADMIN));

    const statement = sqlStatement(sql);

    expect(statement).toMatch(
      /property_affairs\.visibility_scope = 'ALL'\s+OR\s+property_affairs\.created_by = \?\s+OR\s+EXISTS/i,
    );
    expect(statement).toContain('FROM property_affair_viewers pav');
    expect(statement).toContain('JOIN users u ON u.id = pav.user_id');
    expect(statement).toContain('pav.affair_id = property_affairs.id');
    expect(statement).toContain('pav.user_id = ?');
    expect(statement).toContain("u.status = 'ACTIVE'");
    expect(sql.values).toEqual([42, 42]);
    expect(statement).not.toContain('42');
  });
});
