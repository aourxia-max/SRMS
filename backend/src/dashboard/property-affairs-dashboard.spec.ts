import { MODULE_METADATA } from '@nestjs/common/constants';
import {
  PropertyAffairPriority,
  PropertyAffairStatus,
  UserRole,
} from '@prisma/client';
import { FinanceModule } from '../finance/finance.module';
import { PropertyAffairsModule } from '../property-affairs/property-affairs.module';
import { PropertyAffairsService } from '../property-affairs/property-affairs.service';
import { DashboardModule } from './dashboard.module';
import { DashboardService } from './dashboard.service';

function dashboardDependencies() {
  const prisma = {
    db: {
      systemSetting: { findMany: jest.fn().mockResolvedValue([]) },
      room: { findMany: jest.fn().mockResolvedValue([]) },
      rentBill: { findMany: jest.fn().mockResolvedValue([]) },
      contract: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
      checkoutSettlement: { count: jest.fn().mockResolvedValue(0) },
      billAdjustment: { findMany: jest.fn().mockResolvedValue([]) },
      paymentRefund: { findMany: jest.fn().mockResolvedValue([]) },
      pricingRebate: { findMany: jest.fn().mockResolvedValue([]) },
    },
  } as never;
  const finance = {
    rentCollection: jest.fn().mockResolvedValue({
      total: {
        netReceivable: '100.00',
        validReceived: '80.00',
        outstanding: '20.00',
      },
      collectionRate: '80.00',
    }),
  };
  const propertyAffairs = {
    dashboardItems: jest
      .fn()
      .mockResolvedValue([{ id: 18, title: '电梯检修' }]),
  };
  return { prisma, finance, propertyAffairs };
}

describe('DashboardService property-affair role visibility', () => {
  it.each([UserRole.SUPER_ADMIN, UserRole.ADMIN])(
    'loads at most eight property affairs for %s',
    async (role) => {
      const { prisma, finance, propertyAffairs } = dashboardDependencies();
      const service = new DashboardService(
        prisma,
        finance as never,
        propertyAffairs as unknown as PropertyAffairsService,
      );

      const result = await service.summary({
        id: role === UserRole.SUPER_ADMIN ? 1 : 2,
        username: role.toLowerCase(),
        displayName: role,
        role,
      });

      expect(result.propertyAffairs).toEqual([{ id: 18, title: '电梯检修' }]);
      expect(propertyAffairs.dashboardItems).toHaveBeenCalledTimes(1);
      expect(propertyAffairs.dashboardItems).toHaveBeenCalledWith(8);
    },
  );

  it('returns no property-affair data to a visitor and never calls the service', async () => {
    const { prisma, finance, propertyAffairs } = dashboardDependencies();
    const service = new DashboardService(
      prisma,
      finance as never,
      propertyAffairs as unknown as PropertyAffairsService,
    );

    const result = await service.summary({
      id: 3,
      username: 'visitor',
      displayName: '访客',
      role: UserRole.VISITOR,
    });

    expect(result.propertyAffairs).toEqual([]);
    expect(propertyAffairs.dashboardItems).not.toHaveBeenCalled();
    expect(finance.rentCollection).not.toHaveBeenCalled();
    expect(result).not.toHaveProperty('rentCollectionOverview');
    expect(result).not.toHaveProperty('arrearsTotal');
  });

  it('preserves the existing super-only finance overview', async () => {
    const { prisma, finance, propertyAffairs } = dashboardDependencies();
    const superResult = await new DashboardService(
      prisma,
      finance as never,
      propertyAffairs as unknown as PropertyAffairsService,
    ).summary({
      id: 1,
      username: 'root',
      displayName: '超级管理员',
      role: UserRole.SUPER_ADMIN,
    });

    expect(finance.rentCollection).toHaveBeenCalledTimes(1);
    expect(superResult.rentCollectionOverview).toEqual(
      expect.objectContaining({
        netReceivable: '100.00',
        validReceived: '80.00',
        outstanding: '20.00',
        collectionRate: '80.00',
      }),
    );
    expect(superResult).toHaveProperty('arrearsTotal');

    jest.mocked(finance.rentCollection).mockClear();
    const adminResult = await new DashboardService(
      prisma,
      finance as never,
      propertyAffairs as unknown as PropertyAffairsService,
    ).summary({
      id: 2,
      username: 'admin',
      displayName: '管理员',
      role: UserRole.ADMIN,
    });

    expect(finance.rentCollection).not.toHaveBeenCalled();
    expect(adminResult).not.toHaveProperty('rentCollectionOverview');
    expect(adminResult).not.toHaveProperty('arrearsTotal');
  });
});

describe('PropertyAffairsService dashboard ordering', () => {
  const affair = (
    id: number,
    priority: PropertyAffairPriority,
    status: PropertyAffairStatus,
  ) =>
    ({
      id,
      affairNo: `WY20260902${String(id).padStart(4, '0')}`,
      title: `事项${id}`,
      category: null,
      priority,
      status,
      content: '内容',
      responsibleUserId: null,
      responsibleSnapshot: null,
      externalHandlerName: null,
      externalPhone: null,
      externalContact: null,
      completedAt: null,
      cancelledAt: null,
      createdBy: 1,
      updatedBy: 1,
      deletedAt: null,
      deletedBy: null,
      version: 1,
      createdAt: new Date('2026-09-01T00:00:00.000Z'),
      updatedAt: new Date(`2026-09-02T00:00:0${id}.000Z`),
      buildings: [],
      rooms: [],
      tenants: [],
      contracts: [],
      progresses: [],
      files: [],
    }) as never;

  it('emits explicit urgent-important-normal ordering with a safely bound limit', async () => {
    const queryRaw = jest.fn().mockResolvedValue([]);
    const db = {
      $queryRaw: queryRaw,
      propertyAffair: { findMany: jest.fn().mockResolvedValue([]) },
      building: { findMany: jest.fn().mockResolvedValue([]) },
      room: { findMany: jest.fn().mockResolvedValue([]) },
      tenant: { findMany: jest.fn().mockResolvedValue([]) },
      contract: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const service = new PropertyAffairsService({ db } as never);

    await service.dashboardItems(8);

    const [segments, boundLimit] = queryRaw.mock.calls[0] as [
      TemplateStringsArray,
      number,
    ];
    const emittedSql = segments.join('?').replace(/\s+/g, ' ').trim();
    expect(emittedSql).toBe(
      "SELECT id FROM property_affairs WHERE deleted_at IS NULL AND status IN ('PENDING', 'IN_PROGRESS') ORDER BY CASE priority WHEN 'URGENT' THEN 0 WHEN 'IMPORTANT' THEN 1 ELSE 2 END, updated_at DESC, id DESC LIMIT ?",
    );
    expect(boundLimit).toBe(8);
  });

  it('reloads active summaries once and preserves the raw ID order across races', async () => {
    const propertyAffairFindMany = jest
      .fn()
      .mockResolvedValue([
        affair(9, PropertyAffairPriority.NORMAL, PropertyAffairStatus.PENDING),
        affair(
          4,
          PropertyAffairPriority.URGENT,
          PropertyAffairStatus.IN_PROGRESS,
        ),
      ]);
    const buildingFindMany = jest.fn().mockResolvedValue([]);
    const roomFindMany = jest.fn().mockResolvedValue([]);
    const tenantFindMany = jest.fn().mockResolvedValue([]);
    const contractFindMany = jest.fn().mockResolvedValue([]);
    const db = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 4 }, { id: 2 }, { id: 9 }]),
      propertyAffair: { findMany: propertyAffairFindMany },
      building: { findMany: buildingFindMany },
      room: { findMany: roomFindMany },
      tenant: { findMany: tenantFindMany },
      contract: { findMany: contractFindMany },
    };
    const service = new PropertyAffairsService({ db } as never);

    const result = await service.dashboardItems(8);

    expect(propertyAffairFindMany).toHaveBeenCalledTimes(1);
    expect(propertyAffairFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: { in: [4, 2, 9] },
          deletedAt: null,
          status: {
            in: [
              PropertyAffairStatus.PENDING,
              PropertyAffairStatus.IN_PROGRESS,
            ],
          },
        },
      }),
    );
    expect(result.map((item) => item.id)).toEqual([4, 9]);
    expect(buildingFindMany).toHaveBeenCalledTimes(1);
    expect(roomFindMany).toHaveBeenCalledTimes(1);
    expect(tenantFindMany).toHaveBeenCalledTimes(1);
    expect(contractFindMany).toHaveBeenCalledTimes(1);
  });
});

describe('DashboardModule metadata', () => {
  it('keeps FinanceModule and imports PropertyAffairsModule', () => {
    expect(
      Reflect.getMetadata(MODULE_METADATA.IMPORTS, DashboardModule),
    ).toEqual([FinanceModule, PropertyAffairsModule]);
  });
});
