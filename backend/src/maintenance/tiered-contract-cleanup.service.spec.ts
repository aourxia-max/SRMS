import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { readFile, unlink } from 'node:fs/promises';
import { PrismaService } from '../prisma/prisma.service';
import {
  CLEANUP_CONFIRMATION,
  CLEANUP_FINAL_AUTHORIZATION,
  TieredContractCleanupService,
} from './tiered-contract-cleanup.service';

jest.mock('node:fs/promises', () => ({
  readFile: jest.fn(),
  unlink: jest.fn(),
}));

const BACKUP_CONTENT = Buffer.from('database backup');
const BACKUP_CHECKSUM = createHash('sha256')
  .update(BACKUP_CONTENT)
  .digest('hex');

type MockDb = ReturnType<typeof createDb>;

function delegate() {
  return {
    findMany: jest.fn().mockResolvedValue([]),
    findUnique: jest.fn().mockResolvedValue(null),
    findFirst: jest.fn().mockResolvedValue(null),
    count: jest.fn().mockResolvedValue(0),
    update: jest.fn().mockResolvedValue({}),
    updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    create: jest.fn().mockResolvedValue({}),
    deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
  };
}

function createDb() {
  const db = {
    backupRecord: delegate(),
    contract: delegate(),
    contractPricingTier: delegate(),
    pricingRebate: delegate(),
    pricingRebateFile: delegate(),
    rentBill: delegate(),
    billAdjustment: delegate(),
    payment: delegate(),
    paymentRefund: delegate(),
    paymentVoidRequest: delegate(),
    paymentAllocation: delegate(),
    paymentFile: delegate(),
    paymentRefundAdjustmentDecision: delegate(),
    paymentRefundAllocation: delegate(),
    prepaymentTransaction: delegate(),
    depositTransaction: delegate(),
    checkoutSettlement: delegate(),
    checkoutSettlementItem: delegate(),
    checkoutSettlementItemFile: delegate(),
    depositRefund: delegate(),
    depositRefundFile: delegate(),
    contractMember: delegate(),
    contractConcession: delegate(),
    contractChange: delegate(),
    contractCommission: delegate(),
    contractFile: delegate(),
    roomStatusHistory: delegate(),
    room: delegate(),
    fileAsset: delegate(),
    $queryRaw: jest.fn().mockResolvedValue([]),
    $transaction: jest.fn(),
  };
  db.$transaction.mockImplementation(
    async (work: (tx: typeof db) => Promise<unknown>) => work(db),
  );
  return db;
}

function createService(
  db: MockDb,
  environment: 'test' | 'production' = 'test',
) {
  const config = {
    get: jest.fn((key: string) =>
      key === 'NODE_ENV' ? environment : undefined,
    ),
  } as unknown as ConfigService;
  return new TieredContractCleanupService(
    { db } as unknown as PrismaService,
    config,
  );
}

function validAuthorization() {
  return {
    environment: 'test' as const,
    backupNo: 'BK-TEST-1',
    confirmation: CLEANUP_CONFIRMATION,
    finalAuthorization: CLEANUP_FINAL_AUTHORIZATION,
    preflightFingerprint: '0'.repeat(64),
  };
}

function successfulBackup() {
  return {
    backupNo: 'BK-TEST-1',
    status: 'SUCCESS',
    checksum: BACKUP_CHECKSUM,
    databasePath: '/backups/BK-TEST-1.sql',
    retentionUntil: new Date('2026-09-01T00:00:00.000Z'),
  };
}

describe('TieredContractCleanupService', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-09T00:00:00.000Z'));
    jest.mocked(readFile).mockResolvedValue(BACKUP_CONTENT);
    jest.mocked(unlink).mockResolvedValue();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('预检只读取阶梯合同清单、表计数、房源、附件和外键，不启动事务', async () => {
    const db = createDb();
    db.contract.findMany.mockResolvedValueOnce([
      { id: 7, contractNo: 'HT-TIER-7', roomId: 31 },
    ]);
    db.contractPricingTier.findMany.mockResolvedValueOnce([{ id: 71 }]);
    db.rentBill.findMany.mockResolvedValueOnce([{ id: 81 }]);
    db.payment.findMany.mockResolvedValueOnce([{ id: 91 }]);
    db.contractFile.findMany.mockResolvedValueOnce([{ fileAssetId: 501 }]);
    db.contractMember.count.mockResolvedValueOnce(2);
    db.$queryRaw.mockResolvedValueOnce([
      {
        tableName: 'contract_members',
        columnName: 'contract_id',
        referencedTableName: 'contracts',
        referencedColumnName: 'id',
        constraintName: 'contract_members_contract_id_fkey',
      },
    ]);

    const report = await createService(db).preflight();

    expect(report).toEqual(
      expect.objectContaining({
        contractIds: [7],
        contractNos: ['HT-TIER-7'],
        affectedRoomIds: [31],
        attachmentCount: 1,
        tableCounts: expect.objectContaining({
          contracts: 1,
          contract_members: 2,
        }),
        unknownDependencies: [],
      }),
    );
    expect(report.foreignKeys).toHaveLength(1);
    expect(db.$transaction).not.toHaveBeenCalled();
    for (const value of Object.values(db)) {
      if (typeof value === 'object' && value && 'deleteMany' in value) {
        expect(value.deleteMany).not.toHaveBeenCalled();
      }
    }
  });

  it('缺少备份编号时在任何预检或写操作前阻断', async () => {
    const db = createDb();
    const service = createService(db);

    await expect(
      service.execute({ ...validAuthorization(), backupNo: '' }),
    ).rejects.toThrow('缺少有效备份');
    expect(db.backupRecord.findUnique).not.toHaveBeenCalled();
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('运行环境与授权环境不一致时阻断', async () => {
    const db = createDb();
    const service = createService(db, 'production');

    await expect(service.execute(validAuthorization())).rejects.toThrow(
      '运行环境不匹配',
    );
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('确认短语不精确匹配时阻断', async () => {
    const db = createDb();
    const service = createService(db);

    await expect(
      service.execute({
        ...validAuthorization(),
        confirmation: `${CLEANUP_CONFIRMATION} `,
      }),
    ).rejects.toThrow('确认短语不匹配');
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('没有独立最终授权短语时阻断', async () => {
    const db = createDb();
    const service = createService(db);

    await expect(
      service.execute({
        ...validAuthorization(),
        finalAuthorization: '',
      }),
    ).rejects.toThrow('缺少最终执行授权');
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it.each([
    ['FAILED', 'a'.repeat(64), new Date('2026-09-01T00:00:00.000Z')],
    ['SUCCESS', null, new Date('2026-09-01T00:00:00.000Z')],
    ['SUCCESS', 'a'.repeat(64), new Date('2026-08-08T00:00:00.000Z')],
  ])(
    '备份不成功、无校验和或已过期时阻断',
    async (status, checksum, retentionUntil) => {
      const db = createDb();
      db.backupRecord.findUnique.mockResolvedValueOnce({
        ...successfulBackup(),
        status,
        checksum,
        retentionUntil,
      });

      await expect(
        createService(db).execute(validAuthorization()),
      ).rejects.toThrow('缺少有效备份');
      expect(db.$transaction).not.toHaveBeenCalled();
    },
  );

  it('发现静态清单之外的新外键依赖时阻断执行', async () => {
    const db = createDb();
    db.backupRecord.findUnique.mockResolvedValueOnce(successfulBackup());
    db.$queryRaw.mockResolvedValueOnce([
      {
        tableName: 'unexpected_ledger',
        columnName: 'contract_id',
        referencedTableName: 'contracts',
        referencedColumnName: 'id',
        constraintName: 'unexpected_ledger_contract_id_fkey',
      },
    ]);

    await expect(
      createService(db).execute(validAuthorization()),
    ).rejects.toThrow('发现未知外键依赖');
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('删除与房态重算发生在同一事务中，任一步失败都会整体拒绝', async () => {
    const db = createDb();
    db.backupRecord.findUnique.mockResolvedValueOnce(successfulBackup());
    db.contract.deleteMany.mockResolvedValueOnce({ count: 1 });
    db.contract.findMany
      .mockResolvedValueOnce([{ id: 7, contractNo: 'HT-TIER-7', roomId: 31 }])
      .mockResolvedValueOnce([{ id: 7, contractNo: 'HT-TIER-7', roomId: 31 }])
      .mockResolvedValueOnce([{ id: 7, contractNo: 'HT-TIER-7', roomId: 31 }]);
    db.room.findUnique.mockResolvedValueOnce({ id: 31, roomStatus: 'RENTED' });
    db.room.update.mockRejectedValueOnce(new Error('room update failed'));

    const service = createService(db);
    const reviewed = await service.preflight();
    await expect(
      service.execute({
        ...validAuthorization(),
        preflightFingerprint: reviewed.fingerprint,
      }),
    ).rejects.toThrow('room update failed');
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(db.contract.deleteMany).toHaveBeenCalledWith({
      where: {
        id: { in: [7] },
        pricingMode: 'TIERED_RETROACTIVE',
      },
    });
  });

  it('固定月租合同决定清理后的房态，且固定合同永不进入删除条件', async () => {
    const db = createDb();
    db.backupRecord.findUnique.mockResolvedValueOnce(successfulBackup());
    db.contract.deleteMany.mockResolvedValueOnce({ count: 1 });
    db.contract.findMany
      .mockResolvedValueOnce([{ id: 7, contractNo: 'HT-TIER-7', roomId: 31 }])
      .mockResolvedValueOnce([{ id: 7, contractNo: 'HT-TIER-7', roomId: 31 }])
      .mockResolvedValueOnce([{ id: 7, contractNo: 'HT-TIER-7', roomId: 31 }])
      .mockResolvedValueOnce([{ status: 'ACTIVE' }]);
    db.room.findUnique.mockResolvedValueOnce({
      id: 31,
      roomStatus: 'PENDING_MOVE_IN',
    });
    db.room.update.mockResolvedValueOnce({ id: 31, roomStatus: 'RENTED' });

    const service = createService(db);
    const reviewed = await service.preflight();
    const result = await service.execute({
      ...validAuthorization(),
      preflightFingerprint: reviewed.fingerprint,
    });

    expect(db.contract.deleteMany).toHaveBeenCalledWith({
      where: {
        id: { in: [7] },
        pricingMode: 'TIERED_RETROACTIVE',
      },
    });
    expect(db.contract.findMany).toHaveBeenLastCalledWith({
      where: {
        roomId: 31,
        pricingMode: 'FIXED',
        status: { in: ['PENDING_START', 'ACTIVE', 'PENDING_CHECKOUT'] },
      },
      select: { status: true },
    });
    expect(db.room.update).toHaveBeenCalledWith({
      where: { id: 31 },
      data: expect.objectContaining({ roomStatus: 'RENTED' }),
    });
    expect(result.residualForeignKeys).toEqual([]);
  });

  it('只删除已解除全部业务引用的附件资产，共享附件保留', async () => {
    const db = createDb();
    db.backupRecord.findUnique.mockResolvedValueOnce(successfulBackup());
    db.contract.deleteMany.mockResolvedValueOnce({ count: 1 });
    db.contract.findMany
      .mockResolvedValueOnce([{ id: 7, contractNo: 'HT-TIER-7', roomId: 31 }])
      .mockResolvedValueOnce([{ id: 7, contractNo: 'HT-TIER-7', roomId: 31 }])
      .mockResolvedValueOnce([{ id: 7, contractNo: 'HT-TIER-7', roomId: 31 }]);
    db.contractFile.findMany
      .mockResolvedValueOnce([{ fileAssetId: 501 }, { fileAssetId: 502 }])
      .mockResolvedValueOnce([{ fileAssetId: 501 }, { fileAssetId: 502 }])
      .mockResolvedValueOnce([{ fileAssetId: 501 }, { fileAssetId: 502 }]);
    db.fileAsset.findMany.mockResolvedValueOnce([
      { id: 501, storageKey: 'contract-files/orphan.pdf' },
    ]);
    db.room.findUnique.mockResolvedValueOnce({ id: 31, roomStatus: 'EMPTY' });

    const service = createService(db);
    const reviewed = await service.preflight();
    const result = await service.execute({
      ...validAuthorization(),
      preflightFingerprint: reviewed.fingerprint,
    });

    expect(db.fileAsset.findMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: { in: [501, 502] },
        tenantFiles: { none: {} },
        exportTasks: { none: {} },
        contractFiles: { none: {} },
        pricingRebateFiles: { none: {} },
        paymentFiles: { none: {} },
        checkoutSettlementItemFiles: { none: {} },
        depositRefundFiles: { none: {} },
      }),
      select: { id: true, storageKey: true },
    });
    expect(db.fileAsset.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: [501] } },
    });
    expect(result.deletedFileAssetIds).toEqual([501]);
  });
});
