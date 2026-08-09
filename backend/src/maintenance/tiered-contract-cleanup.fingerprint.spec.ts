import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { PrismaService } from '../prisma/prisma.service';
import { parseCleanupArguments } from './tiered-contract-cleanup.cli';
import {
  CLEANUP_CONFIRMATION,
  CLEANUP_FINAL_AUTHORIZATION,
  CleanupReport,
  TieredContractCleanupService,
} from './tiered-contract-cleanup.service';

jest.mock('node:fs/promises', () => ({
  readFile: jest.fn(),
  unlink: jest.fn(),
}));

function delegate() {
  return {
    findMany: jest.fn().mockResolvedValue([]),
    findUnique: jest.fn().mockResolvedValue(null),
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

function createService(db: ReturnType<typeof createDb>) {
  return new TieredContractCleanupService(
    { db } as unknown as PrismaService,
    {
      get: jest.fn((key: string) => (key === 'NODE_ENV' ? 'test' : undefined)),
    } as unknown as ConfigService,
  );
}

function authorization(preflightFingerprint: string) {
  return {
    environment: 'test' as const,
    backupNo: 'BK-TEST-1',
    confirmation: CLEANUP_CONFIRMATION,
    finalAuthorization: CLEANUP_FINAL_AUTHORIZATION,
    preflightFingerprint,
  };
}

describe('tiered cleanup preflight fingerprint', () => {
  beforeEach(() => {
    jest.mocked(readFile).mockResolvedValue(Buffer.from('database backup'));
  });

  it('预检对精确合同范围生成确定的 SHA-256 指纹', async () => {
    const db = createDb();
    db.contract.findMany.mockResolvedValueOnce([
      { id: 7, contractNo: 'HT-TIER-7', roomId: 31 },
    ]);

    const report = (await createService(db).preflight()) as CleanupReport & {
      fingerprint?: string;
    };

    expect(report.fingerprint).toMatch(/^[a-f0-9]{64}$/);
  });

  it('CLI execute 缺少预检指纹时直接拒绝', () => {
    expect(() =>
      parseCleanupArguments([
        '--mode=execute',
        '--environment=test',
        '--backup-no=BK-TEST-1',
        `--confirmation=${CLEANUP_CONFIRMATION}`,
        `--final-authorization=${CLEANUP_FINAL_AUTHORIZATION}`,
      ]),
    ).toThrow('execute 必须提供 preflight-fingerprint');
  });

  it('用户提供的指纹与执行前最新预检不匹配时不启动事务', async () => {
    const db = createDb();
    db.backupRecord.findUnique.mockResolvedValueOnce({
      backupNo: 'BK-TEST-1',
      status: 'SUCCESS',
      checksum: createHash('sha256').update('database backup').digest('hex'),
      databasePath: '/backups/BK-TEST-1.sql',
      retentionUntil: new Date('2026-09-01T00:00:00.000Z'),
    });
    db.contract.findMany.mockResolvedValueOnce([
      { id: 7, contractNo: 'HT-TIER-7', roomId: 31 },
    ]);

    await expect(
      createService(db).execute(authorization('0'.repeat(64))),
    ).rejects.toThrow('预检指纹不匹配');
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('事务内范围与用户已审阅的指纹不同，在任何删除前整体回滚', async () => {
    const db = createDb();
    db.backupRecord.findUnique.mockResolvedValueOnce({
      backupNo: 'BK-TEST-1',
      status: 'SUCCESS',
      checksum: createHash('sha256').update('database backup').digest('hex'),
      databasePath: '/backups/BK-TEST-1.sql',
      retentionUntil: new Date('2026-09-01T00:00:00.000Z'),
    });
    db.contract.findMany
      .mockResolvedValueOnce([{ id: 7, contractNo: 'HT-TIER-7', roomId: 31 }])
      .mockResolvedValueOnce([{ id: 7, contractNo: 'HT-TIER-7', roomId: 31 }])
      .mockResolvedValueOnce([{ id: 8, contractNo: 'HT-TIER-8', roomId: 32 }]);
    const service = createService(db);
    const reviewed = (await service.preflight()) as CleanupReport & {
      fingerprint: string;
    };

    await expect(
      service.execute(authorization(reviewed.fingerprint)),
    ).rejects.toThrow('预检范围已变化');
    expect(db.contract.deleteMany).not.toHaveBeenCalled();
  });
});
