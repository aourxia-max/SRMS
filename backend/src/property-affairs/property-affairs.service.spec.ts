import {
  PropertyAffairPriority,
  PropertyAffairStatus,
  UserRole,
} from '@prisma/client';
import { PropertyAffairsService } from './property-affairs.service';

const admin = {
  id: 7,
  username: 'admin',
  displayName: '管理员甲',
  role: UserRole.ADMIN,
};

const createdAt = new Date('2026-09-02T03:04:05.000Z');

const baseAffair = {
  id: 41,
  affairNo: 'WY202609020001',
  title: '协调公共维修',
  category: '公共维修',
  priority: PropertyAffairPriority.NORMAL,
  status: 'PENDING' as const,
  content: '协调维修单位处理漏水',
  responsibleUserId: 9,
  responsibleSnapshot: '管理员乙',
  externalHandlerName: '维修公司',
  externalPhone: '021-12345678',
  externalContact: '工作日上午联系',
  completedAt: null,
  cancelledAt: null,
  createdBy: admin.id,
  updatedBy: admin.id,
  deletedAt: null,
  deletedBy: null,
  version: 1,
  createdAt,
  updatedAt: createdAt,
};

function createFixture() {
  const tx = {
    $executeRaw: jest.fn().mockResolvedValue(1),
    $queryRaw: jest.fn().mockResolvedValue([{ currentValue: 1 }]),
    building: {
      findMany: jest
        .fn()
        .mockResolvedValue([
          { id: 1, buildingNo: '1栋', buildingName: '东区', status: 'ACTIVE' },
        ]),
    },
    room: {
      findMany: jest
        .fn()
        .mockResolvedValue([
          { id: 11, fullHouseNo: '1栋101', roomStatus: 'MAINTENANCE' },
        ]),
    },
    tenant: {
      findMany: jest
        .fn()
        .mockResolvedValue([{ id: 21, name: '张三', status: 'ACTIVE' }]),
    },
    contract: {
      findMany: jest
        .fn()
        .mockResolvedValue([{ id: 31, contractNo: 'HT-31', status: 'ACTIVE' }]),
    },
    user: {
      findFirst: jest.fn().mockResolvedValue({
        id: 9,
        displayName: '管理员乙',
        role: UserRole.SUPER_ADMIN,
      }),
    },
    propertyAffair: {
      create: jest.fn().mockResolvedValue(baseAffair),
      findUniqueOrThrow: jest.fn().mockResolvedValue({
        ...baseAffair,
        buildings: [
          { id: 1, affairId: 41, buildingId: 1, targetLabel: '1栋（东区）' },
        ],
        rooms: [{ id: 2, affairId: 41, roomId: 11, targetLabel: '1栋101' }],
        tenants: [{ id: 3, affairId: 41, tenantId: 21, targetLabel: '张三' }],
        contracts: [
          { id: 4, affairId: 41, contractId: 31, targetLabel: 'HT-31' },
        ],
        progresses: [
          {
            id: 5,
            affairId: 41,
            content: '事项已创建',
            statusBefore: null,
            statusAfter: 'PENDING',
            createdBy: admin.id,
            createdBySnapshot: admin.displayName,
            createdAt,
          },
        ],
        files: [],
      }),
    },
    propertyAffairBuilding: {
      createMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    propertyAffairRoom: {
      createMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    propertyAffairTenant: {
      createMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    propertyAffairContract: {
      createMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    propertyAffairProgress: { create: jest.fn().mockResolvedValue({ id: 5 }) },
    operationLog: { create: jest.fn().mockResolvedValue({ id: 6 }) },
  };
  const db = {
    $transaction: jest.fn((callback: (client: typeof tx) => Promise<unknown>) =>
      callback(tx),
    ),
  };
  return {
    service: new PropertyAffairsService({ db } as never),
    db,
    tx,
  };
}

describe('PropertyAffairsService', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('creates a numbered affair, all relation snapshots, initial progress and audit in one transaction', async () => {
    jest.useFakeTimers().setSystemTime(createdAt);
    const { service, db, tx } = createFixture();

    const result = await service.create(
      {
        title: baseAffair.title,
        category: baseAffair.category,
        priority: baseAffair.priority,
        content: baseAffair.content,
        responsibleUserId: 9,
        externalHandlerName: baseAffair.externalHandlerName,
        externalPhone: baseAffair.externalPhone,
        externalContact: baseAffair.externalContact,
        buildingIds: [1],
        roomIds: [11],
        tenantIds: [21],
        contractIds: [31],
      },
      admin,
    );

    expect(result).toEqual(
      expect.objectContaining({
        id: 41,
        affairNo: 'WY202609020001',
        version: 1,
      }),
    );
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    const sequenceUpsert = tx.$executeRaw.mock.calls[0];
    expect((sequenceUpsert[0] as TemplateStringsArray).join('?')).toContain(
      'ON DUPLICATE KEY UPDATE current_value = current_value + 1',
    );
    expect(sequenceUpsert.slice(1)).toEqual(['20260902']);
    const sequenceLock = tx.$queryRaw.mock.calls[0];
    expect((sequenceLock[0] as TemplateStringsArray).join('?')).toContain(
      'FOR UPDATE',
    );
    expect(sequenceLock.slice(1)).toEqual(['20260902']);

    expect(tx.building.findMany).toHaveBeenCalledWith({
      where: { id: { in: [1] } },
      select: {
        id: true,
        buildingNo: true,
        buildingName: true,
        status: true,
      },
    });
    expect(tx.room.findMany).toHaveBeenCalledWith({
      where: { id: { in: [11] } },
      select: {
        id: true,
        fullHouseNo: true,
        roomStatus: true,
        deletedAt: true,
      },
    });
    expect(tx.tenant.findMany).toHaveBeenCalledWith({
      where: { id: { in: [21] } },
      select: { id: true, name: true, status: true },
    });
    expect(tx.contract.findMany).toHaveBeenCalledWith({
      where: { id: { in: [31] } },
      select: { id: true, contractNo: true, status: true },
    });
    expect(tx.user.findFirst).toHaveBeenCalledWith({
      where: {
        id: 9,
        role: { in: [UserRole.ADMIN, UserRole.SUPER_ADMIN] },
        status: 'ACTIVE',
        deletedAt: null,
      },
      select: { id: true, displayName: true, role: true },
    });

    expect(tx.propertyAffair.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        affairNo: 'WY202609020001',
        status: 'PENDING',
        responsibleSnapshot: '管理员乙',
        createdBy: admin.id,
        updatedBy: admin.id,
      }),
    });
    expect(tx.propertyAffairBuilding.createMany).toHaveBeenCalledWith({
      data: [{ affairId: 41, buildingId: 1, targetLabel: '1栋（东区）' }],
    });
    expect(tx.propertyAffairRoom.createMany).toHaveBeenCalledWith({
      data: [{ affairId: 41, roomId: 11, targetLabel: '1栋101' }],
    });
    expect(tx.propertyAffairTenant.createMany).toHaveBeenCalledWith({
      data: [{ affairId: 41, tenantId: 21, targetLabel: '张三' }],
    });
    expect(tx.propertyAffairContract.createMany).toHaveBeenCalledWith({
      data: [{ affairId: 41, contractId: 31, targetLabel: 'HT-31' }],
    });
    expect(tx.propertyAffairProgress.create).toHaveBeenCalledWith({
      data: {
        affairId: 41,
        content: '事项已创建',
        statusBefore: null,
        statusAfter: 'PENDING',
        createdBy: admin.id,
        createdBySnapshot: admin.displayName,
      },
    });
    expect(tx.operationLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        module: 'PROPERTY_AFFAIRS',
        action: 'CREATE',
        entityType: 'PROPERTY_AFFAIR',
        entityId: 41,
        entityNo: 'WY202609020001',
        operatorId: admin.id,
        operatorRole: admin.role,
      }),
    });
    expect(tx.operationLog.create.mock.calls[0][0].data.afterData).toEqual(
      expect.objectContaining({
        affairNo: 'WY202609020001',
        buildingIds: [1],
        roomIds: [11],
        tenantIds: [21],
        contractIds: [31],
      }),
    );
  });

  it('uses the Asia/Shanghai business date across the UTC day boundary', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-01T16:30:00.000Z'));
    const { service, tx } = createFixture();

    await service.create(
      {
        title: baseAffair.title,
        priority: baseAffair.priority,
        content: baseAffair.content,
        buildingIds: [],
        roomIds: [],
        tenantIds: [],
        contractIds: [],
      },
      admin,
    );

    expect(tx.$executeRaw.mock.calls[0].slice(1)).toEqual(['20260902']);
    expect(tx.$queryRaw.mock.calls[0].slice(1)).toEqual(['20260902']);
    expect(tx.propertyAffair.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ affairNo: 'WY202609020001' }),
    });
  });

  it('allows the final four-digit daily sequence value 9999', async () => {
    const { service, tx } = createFixture();
    tx.$queryRaw.mockResolvedValue([{ currentValue: 9999 }]);

    await service.create(
      {
        title: baseAffair.title,
        priority: baseAffair.priority,
        content: baseAffair.content,
        buildingIds: [],
        roomIds: [],
        tenantIds: [],
        contractIds: [],
      },
      admin,
    );

    expect(tx.propertyAffair.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ affairNo: 'WY202609029999' }),
    });
  });

  it('rejects sequence value 10000 in Chinese before writing an affair', async () => {
    const { service, tx } = createFixture();
    tx.$queryRaw.mockResolvedValue([{ currentValue: 10000 }]);

    await expect(
      service.create(
        {
          title: baseAffair.title,
          priority: baseAffair.priority,
          content: baseAffair.content,
          buildingIds: [],
          roomIds: [],
          tenantIds: [],
          contractIds: [],
        },
        admin,
      ),
    ).rejects.toEqual(
      expect.objectContaining({
        message: '当日物业办事事项已达到上限，请次日再试',
        status: 409,
      }),
    );
    expect(tx.propertyAffair.create).not.toHaveBeenCalled();
    expect(tx.propertyAffairProgress.create).not.toHaveBeenCalled();
    expect(tx.operationLog.create).not.toHaveBeenCalled();
  });

  it.each([
    ['building', '楼栋 1 不存在'],
    ['room', '房源 11 不存在'],
    ['tenant', '承租人 21 不存在'],
    ['contract', '合同 31 不存在'],
  ] as const)(
    'rejects the whole transaction before affair writes when a requested %s is missing',
    async (relation, message) => {
      const { service, tx } = createFixture();
      tx[relation].findMany.mockResolvedValue([]);

      await expect(
        service.create(
          {
            title: baseAffair.title,
            priority: baseAffair.priority,
            content: baseAffair.content,
            buildingIds: [1],
            roomIds: [11],
            tenantIds: [21],
            contractIds: [31],
          },
          admin,
        ),
      ).rejects.toThrow(message);

      expect(tx.propertyAffair.create).not.toHaveBeenCalled();
      expect(tx.propertyAffairProgress.create).not.toHaveBeenCalled();
      expect(tx.operationLog.create).not.toHaveBeenCalled();
    },
  );

  it('rejects an ineligible responsible user before writing the affair', async () => {
    const { service, tx } = createFixture();
    tx.user.findFirst.mockResolvedValue(null);

    await expect(
      service.create(
        {
          title: baseAffair.title,
          priority: baseAffair.priority,
          content: baseAffair.content,
          responsibleUserId: 9,
          buildingIds: [],
          roomIds: [],
          tenantIds: [],
          contractIds: [],
        },
        admin,
      ),
    ).rejects.toThrow('负责人 9 不存在或不可选');

    expect(tx.propertyAffair.create).not.toHaveBeenCalled();
    expect(tx.operationLog.create).not.toHaveBeenCalled();
  });

  it('lists active affairs with keyword, all filters, stable pagination, batched current relations and presenter summaries', async () => {
    const listed = {
      ...baseAffair,
      status: PropertyAffairStatus.IN_PROGRESS,
      version: 2,
      buildings: [{ id: 1, affairId: 41, buildingId: 1, targetLabel: '旧1栋' }],
      rooms: [{ id: 2, affairId: 41, roomId: 11, targetLabel: '旧1栋101' }],
      tenants: [{ id: 3, affairId: 41, tenantId: 21, targetLabel: '旧住户' }],
      contracts: [
        { id: 4, affairId: 41, contractId: 31, targetLabel: '旧合同号' },
      ],
      progresses: [],
      files: [
        {
          affairId: 41,
          fileAssetId: 71,
          createdBy: admin.id,
          createdAt,
          fileAsset: {
            id: 71,
            storageKey: 'property-affairs/71.pdf',
            originalName: '维修单.pdf',
            storedName: '71.pdf',
            mimeType: 'application/pdf',
            extension: '.pdf',
            sizeBytes: 42n,
            sha256: 'a'.repeat(64),
            category: 'PROPERTY_AFFAIR',
            uploadedBy: admin.id,
            uploadedAt: createdAt,
            lockedAt: null,
          },
        },
      ],
    };
    const db = {
      propertyAffair: {
        count: jest.fn().mockResolvedValue(1),
        findMany: jest.fn().mockResolvedValue([listed]),
      },
      building: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 1,
            buildingNo: '1栋',
            buildingName: '东区',
            status: 'ACTIVE',
          },
        ]),
      },
      room: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            { id: 11, fullHouseNo: '1栋101', roomStatus: 'MAINTENANCE' },
          ]),
      },
      tenant: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ id: 21, name: '张三', status: 'ACTIVE' }]),
      },
      contract: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            { id: 31, contractNo: 'HT-31', status: 'ACTIVE' },
          ]),
      },
    };
    const service = new PropertyAffairsService({ db } as never);

    const result = await service.list({
      keyword: '漏水',
      category: '公共维修',
      priority: PropertyAffairPriority.URGENT,
      status: PropertyAffairStatus.IN_PROGRESS,
      responsibleUserId: 9,
      buildingId: 1,
      roomId: 11,
      tenantId: 21,
      contractId: 31,
      page: 2,
      pageSize: 5,
    });

    const listCall = db.propertyAffair.findMany.mock.calls[0][0];
    expect(listCall).toEqual(
      expect.objectContaining({
        skip: 5,
        take: 5,
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        where: expect.objectContaining({
          deletedAt: null,
          category: '公共维修',
          priority: PropertyAffairPriority.URGENT,
          status: PropertyAffairStatus.IN_PROGRESS,
          responsibleUserId: 9,
          buildings: { some: { buildingId: 1 } },
          rooms: { some: { roomId: 11 } },
          tenants: { some: { tenantId: 21 } },
          contracts: { some: { contractId: 31 } },
        }),
      }),
    );
    expect(listCall.where.OR).toEqual(
      expect.arrayContaining([
        { affairNo: { contains: '漏水' } },
        { title: { contains: '漏水' } },
        { content: { contains: '漏水' } },
        { externalHandlerName: { contains: '漏水' } },
        { externalPhone: { contains: '漏水' } },
        { externalContact: { contains: '漏水' } },
        { buildings: { some: { targetLabel: { contains: '漏水' } } } },
        { rooms: { some: { targetLabel: { contains: '漏水' } } } },
        { tenants: { some: { targetLabel: { contains: '漏水' } } } },
        { contracts: { some: { targetLabel: { contains: '漏水' } } } },
      ]),
    );
    expect(db.propertyAffair.count).toHaveBeenCalledWith({
      where: listCall.where,
    });
    expect(db.building.findMany).toHaveBeenCalledTimes(1);
    expect(db.room.findMany).toHaveBeenCalledTimes(1);
    expect(db.tenant.findMany).toHaveBeenCalledTimes(1);
    expect(db.contract.findMany).toHaveBeenCalledTimes(1);
    expect(result).toEqual(
      expect.objectContaining({ total: 1, page: 2, pageSize: 5 }),
    );
    expect(result.items[0]).toEqual(
      expect.objectContaining({
        id: 41,
        version: 2,
        buildings: [
          {
            id: 1,
            snapshotLabel: '旧1栋',
            currentLabel: '1栋（东区）',
            currentStatus: 'ACTIVE',
            available: true,
          },
        ],
        rooms: [
          {
            id: 11,
            snapshotLabel: '旧1栋101',
            currentLabel: '1栋101',
            currentStatus: 'MAINTENANCE',
            available: true,
          },
        ],
        files: [
          {
            id: 71,
            originalName: '维修单.pdf',
            mimeType: 'application/pdf',
            extension: '.pdf',
            sizeBytes: '42',
            uploadedAt: createdAt,
          },
        ],
      }),
    );
  });

  it('gets detail with newest progress and current-or-snapshot relations, and explicitly includes deleted rows only when requested', async () => {
    const loaded = {
      ...baseAffair,
      buildings: [{ id: 1, affairId: 41, buildingId: 1, targetLabel: '旧1栋' }],
      rooms: [{ id: 2, affairId: 41, roomId: 11, targetLabel: '旧1栋101' }],
      tenants: [],
      contracts: [],
      progresses: [
        {
          id: 8,
          affairId: 41,
          content: '第二条',
          statusBefore: 'PENDING',
          statusAfter: 'IN_PROGRESS',
          createdBy: 8,
          createdBySnapshot: '管理员乙',
          createdAt: new Date('2026-09-02T04:00:00Z'),
        },
        {
          id: 7,
          affairId: 41,
          content: '第一条',
          statusBefore: null,
          statusAfter: 'PENDING',
          createdBy: 7,
          createdBySnapshot: '管理员甲',
          createdAt,
        },
      ],
      files: [],
    };
    const db = {
      propertyAffair: { findFirst: jest.fn().mockResolvedValue(loaded) },
      building: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 1,
            buildingNo: '1栋',
            buildingName: null,
            status: 'DISABLED',
          },
        ]),
      },
      room: { findMany: jest.fn().mockResolvedValue([]) },
      tenant: { findMany: jest.fn().mockResolvedValue([]) },
      contract: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const service = new PropertyAffairsService({ db } as never);

    const ordinary = await service.get(41);
    expect(db.propertyAffair.findFirst.mock.calls[0][0]).toEqual(
      expect.objectContaining({ where: { id: 41, deletedAt: null } }),
    );
    expect(
      db.propertyAffair.findFirst.mock.calls[0][0].include.progresses,
    ).toEqual({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    expect(ordinary.progresses.map((item) => item.id)).toEqual([8, 7]);
    expect(ordinary.buildings[0]).toEqual({
      id: 1,
      snapshotLabel: '旧1栋',
      currentLabel: '1栋',
      currentStatus: 'DISABLED',
      available: true,
    });
    expect(ordinary.rooms[0]).toEqual({
      id: 11,
      snapshotLabel: '旧1栋101',
      currentLabel: '旧1栋101',
      currentStatus: null,
      available: false,
    });

    await service.get(41, true);
    expect(db.propertyAffair.findFirst.mock.calls[1][0]).toEqual(
      expect.objectContaining({ where: { id: 41 } }),
    );
  });

  it('returns repository-standard Chinese 404 for missing or deleted ordinary detail', async () => {
    const db = {
      propertyAffair: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const service = new PropertyAffairsService({ db } as never);
    await expect(service.get(404)).rejects.toEqual(
      expect.objectContaining({ message: '办事事项不存在', status: 404 }),
    );
  });

  it('returns ordered built-in and normalized historical categories and eligible responsible-user projections', async () => {
    const db = {
      propertyAffair: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            { category: ' 消防协调 ' },
            { category: '公共维修' },
            { category: '' },
            { category: null },
            { category: '消防协调' },
          ]),
      },
      user: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            { id: 9, displayName: '管理员乙', role: UserRole.ADMIN },
          ]),
      },
    };
    const service = new PropertyAffairsService({ db } as never);

    await expect(service.categories()).resolves.toEqual([
      '公共维修',
      '证件资料',
      '沟通协调',
      '消防协调',
    ]);
    await expect(service.responsibleUsers()).resolves.toEqual([
      { id: 9, displayName: '管理员乙', role: UserRole.ADMIN },
    ]);
    expect(db.user.findMany).toHaveBeenCalledWith({
      where: {
        role: { in: [UserRole.ADMIN, UserRole.SUPER_ADMIN] },
        status: 'ACTIVE',
        deletedAt: null,
      },
      select: { id: true, displayName: true, role: true },
      orderBy: [{ displayName: 'asc' }, { id: 'asc' }],
    });
  });

  function updateFixture(
    currentStatus: PropertyAffairStatus,
    finalStatus: PropertyAffairStatus = currentStatus,
  ) {
    const current = {
      ...baseAffair,
      version: 3,
      status: currentStatus,
      completedAt:
        currentStatus === PropertyAffairStatus.COMPLETED ? createdAt : null,
      cancelledAt:
        currentStatus === PropertyAffairStatus.CANCELLED ? createdAt : null,
      buildings: [{ id: 1, affairId: 41, buildingId: 1, targetLabel: '旧1栋' }],
      rooms: [{ id: 2, affairId: 41, roomId: 11, targetLabel: '旧1栋101' }],
      tenants: [{ id: 3, affairId: 41, tenantId: 21, targetLabel: '旧住户' }],
      contracts: [
        { id: 4, affairId: 41, contractId: 31, targetLabel: '旧合同' },
      ],
      progresses: [],
      files: [],
    };
    const updated = {
      ...current,
      title: '更新后的事项',
      status: finalStatus,
      version: 4,
      completedAt:
        finalStatus === PropertyAffairStatus.COMPLETED ? createdAt : null,
      cancelledAt:
        finalStatus === PropertyAffairStatus.CANCELLED ? createdAt : null,
      buildings: [{ id: 11, affairId: 41, buildingId: 2, targetLabel: '2栋' }],
      rooms: [{ id: 12, affairId: 41, roomId: 12, targetLabel: '2栋201' }],
      tenants: [{ id: 13, affairId: 41, tenantId: 22, targetLabel: '李四' }],
      contracts: [
        { id: 14, affairId: 41, contractId: 32, targetLabel: 'HT-32' },
      ],
    };
    const tx = {
      propertyAffair: {
        findFirst: jest.fn().mockResolvedValue(current),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: jest.fn().mockResolvedValue(updated),
      },
      building: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            { id: 2, buildingNo: '2栋', buildingName: null, status: 'ACTIVE' },
          ]),
      },
      room: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            { id: 12, fullHouseNo: '2栋201', roomStatus: 'RENTED' },
          ]),
      },
      tenant: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ id: 22, name: '李四', status: 'ACTIVE' }]),
      },
      contract: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            { id: 32, contractNo: 'HT-32', status: 'ACTIVE' },
          ]),
      },
      user: {
        findFirst: jest.fn().mockResolvedValue({
          id: 9,
          displayName: '管理员乙',
          role: UserRole.ADMIN,
        }),
      },
      propertyAffairBuilding: {
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      propertyAffairRoom: {
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      propertyAffairTenant: {
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      propertyAffairContract: {
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      propertyAffairProgress: {
        create: jest.fn().mockResolvedValue({ id: 20 }),
      },
      operationLog: { create: jest.fn().mockResolvedValue({ id: 21 }) },
    };
    const db = {
      $transaction: jest.fn(
        (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
      ),
    };
    return {
      service: new PropertyAffairsService({ db } as never),
      db,
      tx,
      current,
      updated,
    };
  }

  const replacementRelations = {
    buildingIds: [2],
    roomIds: [12],
    tenantIds: [22],
    contractIds: [32],
  };

  it('optimistically updates main fields, lifecycle, every relation, automatic progress and audit in one transaction', async () => {
    jest.useFakeTimers().setSystemTime(createdAt);
    const { service, db, tx } = updateFixture(
      PropertyAffairStatus.PENDING,
      PropertyAffairStatus.COMPLETED,
    );

    const result = await service.update(
      41,
      {
        version: 3,
        title: '更新后的事项',
        category: '公共维修',
        priority: PropertyAffairPriority.URGENT,
        content: '已完成维修协调',
        responsibleUserId: 9,
        externalHandlerName: '新维修单位',
        externalPhone: '12345',
        externalContact: '王师傅',
        status: PropertyAffairStatus.COMPLETED,
        ...replacementRelations,
      },
      admin,
    );

    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.propertyAffair.updateMany).toHaveBeenCalledWith({
      where: { id: 41, version: 3, deletedAt: null },
      data: expect.objectContaining({
        title: '更新后的事项',
        status: PropertyAffairStatus.COMPLETED,
        completedAt: createdAt,
        cancelledAt: null,
        responsibleUserId: 9,
        responsibleSnapshot: '管理员乙',
        updatedBy: admin.id,
        version: { increment: 1 },
      }),
    });
    for (const delegate of [
      tx.propertyAffairBuilding,
      tx.propertyAffairRoom,
      tx.propertyAffairTenant,
      tx.propertyAffairContract,
    ]) {
      expect(delegate.deleteMany).toHaveBeenCalledWith({
        where: { affairId: 41 },
      });
      expect(
        tx.propertyAffair.updateMany.mock.invocationCallOrder[0],
      ).toBeLessThan(delegate.deleteMany.mock.invocationCallOrder[0]);
    }
    expect(tx.propertyAffairBuilding.createMany).toHaveBeenCalledWith({
      data: [{ affairId: 41, buildingId: 2, targetLabel: '2栋' }],
    });
    expect(tx.propertyAffairRoom.createMany).toHaveBeenCalledWith({
      data: [{ affairId: 41, roomId: 12, targetLabel: '2栋201' }],
    });
    expect(tx.propertyAffairTenant.createMany).toHaveBeenCalledWith({
      data: [{ affairId: 41, tenantId: 22, targetLabel: '李四' }],
    });
    expect(tx.propertyAffairContract.createMany).toHaveBeenCalledWith({
      data: [{ affairId: 41, contractId: 32, targetLabel: 'HT-32' }],
    });
    expect(tx.propertyAffairProgress.create).toHaveBeenCalledWith({
      data: {
        affairId: 41,
        content: '状态由“待办理”变更为“已完成”',
        statusBefore: PropertyAffairStatus.PENDING,
        statusAfter: PropertyAffairStatus.COMPLETED,
        createdBy: admin.id,
        createdBySnapshot: admin.displayName,
      },
    });
    expect(tx.operationLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        module: 'PROPERTY_AFFAIRS',
        action: 'UPDATE',
        entityType: 'PROPERTY_AFFAIR',
        entityId: 41,
        entityNo: 'WY202609020001',
        operatorId: admin.id,
        operatorRole: admin.role,
        beforeData: expect.objectContaining({
          title: baseAffair.title,
          status: PropertyAffairStatus.PENDING,
          roomIds: [11],
          version: 3,
        }),
        afterData: expect.objectContaining({
          title: '更新后的事项',
          status: PropertyAffairStatus.COMPLETED,
          roomIds: [12],
          version: 4,
        }),
      }),
    });
    expect(result).toEqual(
      expect.objectContaining({
        title: '更新后的事项',
        status: PropertyAffairStatus.COMPLETED,
        version: 4,
      }),
    );
  });

  it('clears optional fields, responsible snapshot, persisted output and audit after values', async () => {
    const { service, tx, updated } = updateFixture(
      PropertyAffairStatus.PENDING,
    );
    tx.propertyAffair.findUniqueOrThrow.mockResolvedValue({
      ...updated,
      category: null,
      responsibleUserId: null,
      responsibleSnapshot: null,
      externalHandlerName: null,
      externalPhone: null,
      externalContact: null,
    });

    const result = await service.update(
      41,
      {
        version: 3,
        category: null,
        responsibleUserId: null,
        externalHandlerName: null,
        externalPhone: null,
        externalContact: null,
        ...replacementRelations,
      },
      admin,
    );

    expect(tx.user.findFirst).not.toHaveBeenCalled();
    expect(tx.propertyAffair.updateMany).toHaveBeenCalledWith({
      where: { id: 41, version: 3, deletedAt: null },
      data: expect.objectContaining({
        category: null,
        responsibleUserId: null,
        responsibleSnapshot: null,
        externalHandlerName: null,
        externalPhone: null,
        externalContact: null,
      }),
    });
    expect(result).toEqual(
      expect.objectContaining({
        category: null,
        responsibleUserId: null,
        responsibleSnapshot: null,
        externalHandlerName: null,
        externalPhone: null,
        externalContact: null,
        version: 4,
      }),
    );
    const audit = tx.operationLog.create.mock.calls[0][0].data;
    expect(audit.beforeData).toEqual(
      expect.objectContaining({
        category: '公共维修',
        responsibleUserId: 9,
        responsibleSnapshot: '管理员乙',
        externalHandlerName: '维修公司',
        externalPhone: '021-12345678',
        externalContact: '工作日上午联系',
      }),
    );
    expect(audit.afterData).toEqual(
      expect.objectContaining({
        category: null,
        responsibleUserId: null,
        responsibleSnapshot: null,
        externalHandlerName: null,
        externalPhone: null,
        externalContact: null,
      }),
    );
  });

  it('keeps updateMany as the read-after-write race guard', async () => {
    const { service, tx } = updateFixture(PropertyAffairStatus.PENDING);
    tx.propertyAffair.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      service.update(
        41,
        { version: 3, title: '竞争编辑', ...replacementRelations },
        admin,
      ),
    ).rejects.toEqual(
      expect.objectContaining({
        message: '内容已被其他管理员更新，请刷新后重试',
        status: 409,
      }),
    );
    expect(tx.propertyAffair.updateMany).toHaveBeenCalledWith({
      where: { id: 41, version: 3, deletedAt: null },
      data: expect.objectContaining({ version: { increment: 1 } }),
    });
    expect(tx.propertyAffairRoom.deleteMany).not.toHaveBeenCalled();
    expect(tx.propertyAffairProgress.create).not.toHaveBeenCalled();
    expect(tx.operationLog.create).not.toHaveBeenCalled();
  });

  it('returns stale-version 409 before validating an otherwise illegal transition', async () => {
    const { service, tx } = updateFixture(PropertyAffairStatus.COMPLETED);

    await expect(
      service.update(
        41,
        {
          version: 2,
          status: PropertyAffairStatus.PENDING,
          ...replacementRelations,
        },
        admin,
      ),
    ).rejects.toEqual(
      expect.objectContaining({
        message: '内容已被其他管理员更新，请刷新后重试',
        status: 409,
      }),
    );
    expect(tx.building.findMany).not.toHaveBeenCalled();
    expect(tx.room.findMany).not.toHaveBeenCalled();
    expect(tx.tenant.findMany).not.toHaveBeenCalled();
    expect(tx.contract.findMany).not.toHaveBeenCalled();
    expect(tx.user.findFirst).not.toHaveBeenCalled();
    expect(tx.propertyAffair.updateMany).not.toHaveBeenCalled();
  });

  it('returns stale-version 409 before validating invalid relations or responsible user', async () => {
    const { service, tx } = updateFixture(PropertyAffairStatus.PENDING);
    tx.room.findMany.mockResolvedValue([]);
    tx.user.findFirst.mockResolvedValue(null);

    await expect(
      service.update(
        41,
        {
          version: 2,
          responsibleUserId: 9,
          ...replacementRelations,
        },
        admin,
      ),
    ).rejects.toEqual(
      expect.objectContaining({
        message: '内容已被其他管理员更新，请刷新后重试',
        status: 409,
      }),
    );
    expect(tx.building.findMany).not.toHaveBeenCalled();
    expect(tx.room.findMany).not.toHaveBeenCalled();
    expect(tx.tenant.findMany).not.toHaveBeenCalled();
    expect(tx.contract.findMany).not.toHaveBeenCalled();
    expect(tx.user.findFirst).not.toHaveBeenCalled();
    expect(tx.propertyAffair.updateMany).not.toHaveBeenCalled();
  });

  it('validates the lifecycle policy before the optimistic write', async () => {
    const { service, tx } = updateFixture(PropertyAffairStatus.COMPLETED);
    await expect(
      service.update(
        41,
        {
          version: 3,
          status: PropertyAffairStatus.PENDING,
          ...replacementRelations,
        },
        admin,
      ),
    ).rejects.toThrow('事项状态不能这样变更');
    expect(tx.propertyAffair.updateMany).not.toHaveBeenCalled();
  });

  it.each([PropertyAffairStatus.COMPLETED, PropertyAffairStatus.CANCELLED])(
    'keeps main fields editable in unchanged %s status without automatic progress',
    async (status) => {
      const { service, tx } = updateFixture(status);
      await service.update(
        41,
        { version: 3, title: '更新后的事项', status, ...replacementRelations },
        admin,
      );
      const data = tx.propertyAffair.updateMany.mock.calls[0][0].data;
      expect(data).not.toHaveProperty('completedAt');
      expect(data).not.toHaveProperty('cancelledAt');
      expect(tx.propertyAffairProgress.create).not.toHaveBeenCalled();
      expect(tx.operationLog.create).toHaveBeenCalledTimes(1);
    },
  );

  it.each([PropertyAffairStatus.COMPLETED, PropertyAffairStatus.CANCELLED])(
    'reopens %s to in-progress by clearing current lifecycle timestamps while retaining history',
    async (status) => {
      const { service, tx } = updateFixture(
        status,
        PropertyAffairStatus.IN_PROGRESS,
      );
      await service.update(
        41,
        {
          version: 3,
          status: PropertyAffairStatus.IN_PROGRESS,
          ...replacementRelations,
        },
        admin,
      );
      expect(tx.propertyAffair.updateMany.mock.calls[0][0].data).toEqual(
        expect.objectContaining({ completedAt: null, cancelledAt: null }),
      );
      expect(tx.propertyAffairProgress.create).toHaveBeenCalledTimes(1);
      expect(tx.propertyAffairProgress).not.toHaveProperty('deleteMany');
    },
  );

  it('preserves current room data but marks a soft-deleted room unavailable', async () => {
    const loaded = {
      ...baseAffair,
      buildings: [],
      rooms: [{ id: 2, affairId: 41, roomId: 11, targetLabel: '旧1栋101' }],
      tenants: [],
      contracts: [],
      progresses: [],
      files: [],
    };
    const db = {
      propertyAffair: { findFirst: jest.fn().mockResolvedValue(loaded) },
      building: { findMany: jest.fn().mockResolvedValue([]) },
      room: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 11,
            fullHouseNo: '1栋101',
            roomStatus: 'DISABLED',
            deletedAt: createdAt,
          },
        ]),
      },
      tenant: { findMany: jest.fn().mockResolvedValue([]) },
      contract: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const service = new PropertyAffairsService({ db } as never);

    const result = await service.get(41);

    expect(result.rooms[0]).toEqual({
      id: 11,
      snapshotLabel: '旧1栋101',
      currentLabel: '1栋101',
      currentStatus: 'DISABLED',
      available: false,
    });
  });
});
