import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, PrismaClient, RoomStatus } from '@prisma/client';
import { unlink } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import { PrismaService } from '../prisma/prisma.service';

export const CLEANUP_CONFIRMATION = 'DELETE_ALL_TIERED_CONTRACT_HISTORY';
export const CLEANUP_FINAL_AUTHORIZATION = 'OWNER_APPROVED_EXECUTION';

export type CleanupEnvironment = 'test' | 'production';

export type CleanupAuthorization = {
  environment: CleanupEnvironment;
  backupNo: string;
  confirmation: string;
  finalAuthorization: string;
};

export type ForeignKeyDependency = {
  tableName: string;
  columnName: string;
  referencedTableName: string;
  referencedColumnName: string;
  constraintName: string;
};

export type CleanupReport = {
  contractIds: number[];
  contractNos: string[];
  tableCounts: Record<string, number>;
  affectedRoomIds: number[];
  attachmentCount: number;
  foreignKeys: ForeignKeyDependency[];
  unknownDependencies: ForeignKeyDependency[];
};

export type CleanupResult = {
  contractIds: number[];
  deletedTableCounts: Record<string, number>;
  deletedFileAssetIds: number[];
  manualFileCleanup: string[];
  residualForeignKeys: ForeignKeyDependency[];
};

type CleanupDb = Prisma.TransactionClient;

type CleanupScope = {
  contracts: Array<{ id: number; contractNo: string; roomId: number }>;
  contractIds: number[];
  roomIds: number[];
  pricingTierIds: number[];
  rebateIds: number[];
  billIds: number[];
  paymentIds: number[];
  refundIds: number[];
  allocationIds: number[];
  adjustmentIds: number[];
  settlementIds: number[];
  settlementItemIds: number[];
  depositRefundIds: number[];
  fileAssetIds: number[];
};

const TARGET_TABLES = [
  'contracts',
  'contract_pricing_tiers',
  'pricing_rebates',
  'pricing_rebate_files',
  'rent_bills',
  'bill_adjustments',
  'payments',
  'payment_refunds',
  'payment_void_requests',
  'payment_allocations',
  'payment_files',
  'payment_refund_adjustment_decisions',
  'payment_refund_allocations',
  'prepayment_transactions',
  'deposit_transactions',
  'checkout_settlements',
  'checkout_settlement_items',
  'checkout_settlement_item_files',
  'deposit_refunds',
  'deposit_refund_files',
  'contract_members',
  'contract_concessions',
  'contract_changes',
  'contract_commissions',
  'contract_files',
  'room_status_histories',
  'file_assets',
] as const;

const KNOWN_FOREIGN_KEYS = new Set([
  'contract_files.contract_id->contracts.id',
  'contract_commissions.contract_id->contracts.id',
  'contract_changes.contract_id->contracts.id',
  'contract_concessions.contract_id->contracts.id',
  'contract_members.contract_id->contracts.id',
  'contract_pricing_tiers.contract_id->contracts.id',
  'pricing_rebates.contract_id->contracts.id',
  'rent_bills.contract_id->contracts.id',
  'payments.contract_id->contracts.id',
  'payment_refunds.contract_id->contracts.id',
  'prepayment_transactions.contract_id->contracts.id',
  'deposit_transactions.contract_id->contracts.id',
  'checkout_settlements.contract_id->contracts.id',
  'deposit_refunds.contract_id->contracts.id',
  'contracts.current_pricing_tier_id->contract_pricing_tiers.id',
  'pricing_rebates.pricing_tier_id->contract_pricing_tiers.id',
  'rent_bills.contract_pricing_tier_id->contract_pricing_tiers.id',
  'pricing_rebates.parent_rebate_id->pricing_rebates.id',
  'pricing_rebate_files.pricing_rebate_id->pricing_rebates.id',
  'pricing_rebates.rent_bill_id->rent_bills.id',
  'bill_adjustments.rent_bill_id->rent_bills.id',
  'payment_allocations.rent_bill_id->rent_bills.id',
  'prepayment_transactions.rent_bill_id->rent_bills.id',
  'deposit_transactions.rent_bill_id->rent_bills.id',
  'checkout_settlement_items.rent_bill_id->rent_bills.id',
  'bill_adjustments.source_payment_id->payments.id',
  'payment_refunds.payment_id->payments.id',
  'payment_void_requests.payment_id->payments.id',
  'payment_allocations.payment_id->payments.id',
  'payment_files.payment_id->payments.id',
  'prepayment_transactions.payment_id->payments.id',
  'deposit_transactions.payment_id->payments.id',
  'payment_refund_adjustment_decisions.payment_refund_id->payment_refunds.id',
  'payment_refund_allocations.payment_refund_id->payment_refunds.id',
  'payment_refund_allocations.payment_allocation_id->payment_allocations.id',
  'payment_refund_adjustment_decisions.bill_adjustment_id->bill_adjustments.id',
  'payment_refund_adjustment_decisions.reversal_adjustment_id->bill_adjustments.id',
  'checkout_settlement_items.checkout_settlement_id->checkout_settlements.id',
  'deposit_transactions.checkout_settlement_id->checkout_settlements.id',
  'deposit_refunds.checkout_settlement_id->checkout_settlements.id',
  'checkout_settlement_item_files.checkout_settlement_item_id->checkout_settlement_items.id',
  'deposit_transactions.deposit_refund_id->deposit_refunds.id',
  'deposit_refund_files.deposit_refund_id->deposit_refunds.id',
  'tenant_files.file_asset_id->file_assets.id',
  'export_tasks.file_asset_id->file_assets.id',
  'contract_files.file_asset_id->file_assets.id',
  'pricing_rebate_files.file_asset_id->file_assets.id',
  'payment_files.file_asset_id->file_assets.id',
  'checkout_settlement_item_files.file_asset_id->file_assets.id',
  'deposit_refund_files.file_asset_id->file_assets.id',
]);

const PRESERVED_ROOM_STATUSES = new Set<RoomStatus>([
  'MAINTENANCE',
  'FOR_SALE',
  'SOLD',
  'DISABLED',
  'OTHER',
]);

function unique(values: number[]): number[] {
  return [...new Set(values)];
}

function foreignKeyKey(item: ForeignKeyDependency): string {
  return `${item.tableName}.${item.columnName}->${item.referencedTableName}.${item.referencedColumnName}`;
}

@Injectable()
export class TieredContractCleanupService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async preflight(): Promise<CleanupReport> {
    const scope = await this.collectScope(this.prisma.db);
    const [tableCounts, foreignKeys] = await Promise.all([
      this.tableCounts(this.prisma.db, scope),
      this.readForeignKeys(),
    ]);
    return {
      contractIds: scope.contractIds,
      contractNos: scope.contracts.map((item) => item.contractNo),
      tableCounts,
      affectedRoomIds: scope.roomIds,
      attachmentCount: scope.fileAssetIds.length,
      foreignKeys,
      unknownDependencies: foreignKeys.filter(
        (item) => !KNOWN_FOREIGN_KEYS.has(foreignKeyKey(item)),
      ),
    };
  }

  async execute(input: CleanupAuthorization): Promise<CleanupResult> {
    await this.assertAuthorized(input);
    const report = await this.preflight();
    if (report.unknownDependencies.length > 0) {
      throw new Error('发现未知外键依赖，禁止执行清理');
    }

    const transactionResult = await this.prisma.db.$transaction(async (tx) => {
      const scope = await this.collectScope(tx);
      const deletedTableCounts: Record<string, number> = {};
      if (scope.contractIds.length === 0) {
        return {
          scope,
          deletedTableCounts,
          orphanFiles: [] as Array<{ id: number; storageKey: string }>,
        };
      }

      await this.deleteRelatedRows(tx, scope, deletedTableCounts);
      await this.recalculateRooms(tx, scope.roomIds);
      const orphanFiles = await this.deleteOrphanFileAssets(
        tx,
        scope,
        deletedTableCounts,
      );
      return { scope, deletedTableCounts, orphanFiles };
    });

    const manualFileCleanup = await this.removePhysicalFiles(
      transactionResult.orphanFiles,
    );
    const residualForeignKeys = (await this.readForeignKeys()).filter(
      (item) => !KNOWN_FOREIGN_KEYS.has(foreignKeyKey(item)),
    );

    return {
      contractIds: transactionResult.scope.contractIds,
      deletedTableCounts: transactionResult.deletedTableCounts,
      deletedFileAssetIds: transactionResult.orphanFiles.map((item) => item.id),
      manualFileCleanup,
      residualForeignKeys,
    };
  }

  private async assertAuthorized(input: CleanupAuthorization): Promise<void> {
    if (!input.backupNo.trim()) throw new Error('缺少有效备份');
    if (input.environment !== this.config.get<string>('NODE_ENV')) {
      throw new Error('运行环境不匹配');
    }
    if (input.confirmation !== CLEANUP_CONFIRMATION) {
      throw new Error('确认短语不匹配');
    }
    if (input.finalAuthorization !== CLEANUP_FINAL_AUTHORIZATION) {
      throw new Error('缺少最终执行授权');
    }
    const backup = await this.prisma.db.backupRecord.findUnique({
      where: { backupNo: input.backupNo },
      select: {
        backupNo: true,
        status: true,
        checksum: true,
        databasePath: true,
        retentionUntil: true,
      },
    });
    if (
      !backup ||
      backup.status !== 'SUCCESS' ||
      !backup.checksum?.trim() ||
      !backup.databasePath?.trim() ||
      backup.retentionUntil <= new Date()
    ) {
      throw new Error('缺少有效备份');
    }
  }

  private async collectScope(
    db: CleanupDb | PrismaClient,
  ): Promise<CleanupScope> {
    const contracts = await db.contract.findMany({
      where: { pricingMode: 'TIERED_RETROACTIVE' },
      select: { id: true, contractNo: true, roomId: true },
      orderBy: { id: 'asc' },
    });
    const contractIds = contracts.map((item) => item.id);
    const roomIds = unique(contracts.map((item) => item.roomId));
    if (contractIds.length === 0) {
      return {
        contracts,
        contractIds,
        roomIds,
        pricingTierIds: [],
        rebateIds: [],
        billIds: [],
        paymentIds: [],
        refundIds: [],
        allocationIds: [],
        adjustmentIds: [],
        settlementIds: [],
        settlementItemIds: [],
        depositRefundIds: [],
        fileAssetIds: [],
      };
    }

    const pricingTiers = await db.contractPricingTier.findMany({
      where: { contractId: { in: contractIds } },
      select: { id: true },
    });
    const bills = await db.rentBill.findMany({
      where: { contractId: { in: contractIds } },
      select: { id: true },
    });
    const payments = await db.payment.findMany({
      where: { contractId: { in: contractIds } },
      select: { id: true },
    });
    const pricingTierIds = pricingTiers.map((item) => item.id);
    const billIds = bills.map((item) => item.id);
    const paymentIds = payments.map((item) => item.id);

    const rebates = await db.pricingRebate.findMany({
      where: { contractId: { in: contractIds } },
      select: { id: true },
    });
    const refunds = await db.paymentRefund.findMany({
      where: { contractId: { in: contractIds } },
      select: { id: true },
    });
    const allocations = await db.paymentAllocation.findMany({
      where: {
        OR: [
          { paymentId: { in: paymentIds } },
          { rentBillId: { in: billIds } },
        ],
      },
      select: { id: true },
    });
    const adjustments = await db.billAdjustment.findMany({
      where: {
        OR: [
          { rentBillId: { in: billIds } },
          { sourcePaymentId: { in: paymentIds } },
        ],
      },
      select: { id: true },
    });
    const settlements = await db.checkoutSettlement.findMany({
      where: { contractId: { in: contractIds } },
      select: { id: true },
    });
    const settlementIds = settlements.map((item) => item.id);
    const settlementItems = await db.checkoutSettlementItem.findMany({
      where: {
        OR: [
          { checkoutSettlementId: { in: settlementIds } },
          { rentBillId: { in: billIds } },
        ],
      },
      select: { id: true },
    });
    const depositRefunds = await db.depositRefund.findMany({
      where: {
        OR: [
          { contractId: { in: contractIds } },
          { checkoutSettlementId: { in: settlementIds } },
        ],
      },
      select: { id: true },
    });

    const rebateIds = rebates.map((item) => item.id);
    const refundIds = refunds.map((item) => item.id);
    const allocationIds = allocations.map((item) => item.id);
    const adjustmentIds = adjustments.map((item) => item.id);
    const settlementItemIds = settlementItems.map((item) => item.id);
    const depositRefundIds = depositRefunds.map((item) => item.id);
    const fileLinks = await Promise.all([
      db.contractFile.findMany({
        where: { contractId: { in: contractIds } },
        select: { fileAssetId: true },
      }),
      db.pricingRebateFile.findMany({
        where: { pricingRebateId: { in: rebateIds } },
        select: { fileAssetId: true },
      }),
      db.paymentFile.findMany({
        where: { paymentId: { in: paymentIds } },
        select: { fileAssetId: true },
      }),
      db.checkoutSettlementItemFile.findMany({
        where: { checkoutSettlementItemId: { in: settlementItemIds } },
        select: { fileAssetId: true },
      }),
      db.depositRefundFile.findMany({
        where: { depositRefundId: { in: depositRefundIds } },
        select: { fileAssetId: true },
      }),
    ]);

    return {
      contracts,
      contractIds,
      roomIds,
      pricingTierIds,
      rebateIds,
      billIds,
      paymentIds,
      refundIds,
      allocationIds,
      adjustmentIds,
      settlementIds,
      settlementItemIds,
      depositRefundIds,
      fileAssetIds: unique(fileLinks.flat().map((item) => item.fileAssetId)),
    };
  }

  private async tableCounts(
    db: CleanupDb | PrismaClient,
    scope: CleanupScope,
  ): Promise<Record<string, number>> {
    if (scope.contractIds.length === 0) {
      return Object.fromEntries(TARGET_TABLES.map((table) => [table, 0]));
    }
    const historyWhere = this.roomHistoryWhere(scope);
    const values = await Promise.all([
      db.pricingRebateFile.count({
        where: { pricingRebateId: { in: scope.rebateIds } },
      }),
      db.billAdjustment.count({ where: { id: { in: scope.adjustmentIds } } }),
      db.paymentVoidRequest.count({
        where: { paymentId: { in: scope.paymentIds } },
      }),
      db.paymentFile.count({ where: { paymentId: { in: scope.paymentIds } } }),
      db.paymentRefundAdjustmentDecision.count({
        where: {
          OR: [
            { paymentRefundId: { in: scope.refundIds } },
            { billAdjustmentId: { in: scope.adjustmentIds } },
            { reversalAdjustmentId: { in: scope.adjustmentIds } },
          ],
        },
      }),
      db.paymentRefundAllocation.count({
        where: {
          OR: [
            { paymentRefundId: { in: scope.refundIds } },
            { paymentAllocationId: { in: scope.allocationIds } },
          ],
        },
      }),
      db.prepaymentTransaction.count({
        where: { contractId: { in: scope.contractIds } },
      }),
      db.depositTransaction.count({
        where: { contractId: { in: scope.contractIds } },
      }),
      db.checkoutSettlementItemFile.count({
        where: { checkoutSettlementItemId: { in: scope.settlementItemIds } },
      }),
      db.depositRefundFile.count({
        where: { depositRefundId: { in: scope.depositRefundIds } },
      }),
      db.contractMember.count({
        where: { contractId: { in: scope.contractIds } },
      }),
      db.contractConcession.count({
        where: { contractId: { in: scope.contractIds } },
      }),
      db.contractChange.count({
        where: { contractId: { in: scope.contractIds } },
      }),
      db.contractCommission.count({
        where: { contractId: { in: scope.contractIds } },
      }),
      db.contractFile.count({
        where: { contractId: { in: scope.contractIds } },
      }),
      db.roomStatusHistory.count({ where: historyWhere }),
      db.fileAsset.count({
        where: this.unreferencedFileWhere(scope.fileAssetIds),
      }),
    ]);
    return {
      contracts: scope.contractIds.length,
      contract_pricing_tiers: scope.pricingTierIds.length,
      pricing_rebates: scope.rebateIds.length,
      pricing_rebate_files: values[0],
      rent_bills: scope.billIds.length,
      bill_adjustments: values[1],
      payments: scope.paymentIds.length,
      payment_refunds: scope.refundIds.length,
      payment_void_requests: values[2],
      payment_allocations: scope.allocationIds.length,
      payment_files: values[3],
      payment_refund_adjustment_decisions: values[4],
      payment_refund_allocations: values[5],
      prepayment_transactions: values[6],
      deposit_transactions: values[7],
      checkout_settlements: scope.settlementIds.length,
      checkout_settlement_items: scope.settlementItemIds.length,
      checkout_settlement_item_files: values[8],
      deposit_refunds: scope.depositRefundIds.length,
      deposit_refund_files: values[9],
      contract_members: values[10],
      contract_concessions: values[11],
      contract_changes: values[12],
      contract_commissions: values[13],
      contract_files: values[14],
      room_status_histories: values[15],
      file_assets: values[16],
    };
  }

  private async readForeignKeys(): Promise<ForeignKeyDependency[]> {
    return this.prisma.db.$queryRaw<ForeignKeyDependency[]>(Prisma.sql`
      SELECT
        TABLE_NAME AS tableName,
        COLUMN_NAME AS columnName,
        REFERENCED_TABLE_NAME AS referencedTableName,
        REFERENCED_COLUMN_NAME AS referencedColumnName,
        CONSTRAINT_NAME AS constraintName
      FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
      WHERE REFERENCED_TABLE_SCHEMA = DATABASE()
        AND REFERENCED_TABLE_NAME IN (${Prisma.join(TARGET_TABLES)})
      ORDER BY TABLE_NAME, COLUMN_NAME
    `);
  }

  private async deleteRelatedRows(
    tx: CleanupDb,
    scope: CleanupScope,
    counts: Record<string, number>,
  ): Promise<void> {
    const remove = async (
      table: string,
      operation: Promise<{ count: number }>,
    ) => {
      counts[table] = (await operation).count;
    };

    await remove(
      'payment_refund_adjustment_decisions',
      tx.paymentRefundAdjustmentDecision.deleteMany({
        where: {
          OR: [
            { paymentRefundId: { in: scope.refundIds } },
            { billAdjustmentId: { in: scope.adjustmentIds } },
            { reversalAdjustmentId: { in: scope.adjustmentIds } },
          ],
        },
      }),
    );
    await remove(
      'payment_refund_allocations',
      tx.paymentRefundAllocation.deleteMany({
        where: {
          OR: [
            { paymentRefundId: { in: scope.refundIds } },
            { paymentAllocationId: { in: scope.allocationIds } },
          ],
        },
      }),
    );
    await remove(
      'deposit_refund_files',
      tx.depositRefundFile.deleteMany({
        where: { depositRefundId: { in: scope.depositRefundIds } },
      }),
    );
    await remove(
      'checkout_settlement_item_files',
      tx.checkoutSettlementItemFile.deleteMany({
        where: { checkoutSettlementItemId: { in: scope.settlementItemIds } },
      }),
    );
    await remove(
      'pricing_rebate_files',
      tx.pricingRebateFile.deleteMany({
        where: { pricingRebateId: { in: scope.rebateIds } },
      }),
    );
    await remove(
      'payment_files',
      tx.paymentFile.deleteMany({
        where: { paymentId: { in: scope.paymentIds } },
      }),
    );
    await remove(
      'contract_files',
      tx.contractFile.deleteMany({
        where: { contractId: { in: scope.contractIds } },
      }),
    );
    await remove(
      'deposit_transactions',
      tx.depositTransaction.deleteMany({
        where: { contractId: { in: scope.contractIds } },
      }),
    );
    await remove(
      'prepayment_transactions',
      tx.prepaymentTransaction.deleteMany({
        where: { contractId: { in: scope.contractIds } },
      }),
    );
    await remove(
      'payment_void_requests',
      tx.paymentVoidRequest.deleteMany({
        where: { paymentId: { in: scope.paymentIds } },
      }),
    );
    await remove(
      'deposit_refunds',
      tx.depositRefund.deleteMany({
        where: { id: { in: scope.depositRefundIds } },
      }),
    );
    await remove(
      'checkout_settlement_items',
      tx.checkoutSettlementItem.deleteMany({
        where: { id: { in: scope.settlementItemIds } },
      }),
    );
    await remove(
      'checkout_settlements',
      tx.checkoutSettlement.deleteMany({
        where: { id: { in: scope.settlementIds } },
      }),
    );
    await remove(
      'payment_refunds',
      tx.paymentRefund.deleteMany({ where: { id: { in: scope.refundIds } } }),
    );
    await remove(
      'payment_allocations',
      tx.paymentAllocation.deleteMany({
        where: { id: { in: scope.allocationIds } },
      }),
    );
    await remove(
      'bill_adjustments',
      tx.billAdjustment.deleteMany({
        where: { id: { in: scope.adjustmentIds } },
      }),
    );
    await tx.pricingRebate.updateMany({
      where: { id: { in: scope.rebateIds } },
      data: { parentRebateId: null },
    });
    await remove(
      'pricing_rebates',
      tx.pricingRebate.deleteMany({ where: { id: { in: scope.rebateIds } } }),
    );
    await remove(
      'payments',
      tx.payment.deleteMany({ where: { id: { in: scope.paymentIds } } }),
    );
    await remove(
      'contract_commissions',
      tx.contractCommission.deleteMany({
        where: { contractId: { in: scope.contractIds } },
      }),
    );
    await remove(
      'contract_concessions',
      tx.contractConcession.deleteMany({
        where: { contractId: { in: scope.contractIds } },
      }),
    );
    await remove(
      'contract_members',
      tx.contractMember.deleteMany({
        where: { contractId: { in: scope.contractIds } },
      }),
    );
    await remove(
      'rent_bills',
      tx.rentBill.deleteMany({ where: { id: { in: scope.billIds } } }),
    );
    await remove(
      'contract_changes',
      tx.contractChange.deleteMany({
        where: { contractId: { in: scope.contractIds } },
      }),
    );
    await tx.contract.updateMany({
      where: { id: { in: scope.contractIds } },
      data: { currentPricingTierId: null },
    });
    await remove(
      'contract_pricing_tiers',
      tx.contractPricingTier.deleteMany({
        where: { id: { in: scope.pricingTierIds } },
      }),
    );
    await remove(
      'room_status_histories',
      tx.roomStatusHistory.deleteMany({ where: this.roomHistoryWhere(scope) }),
    );
    const contractDelete = await tx.contract.deleteMany({
      where: {
        id: { in: scope.contractIds },
        pricingMode: 'TIERED_RETROACTIVE',
      },
    });
    if (contractDelete.count !== scope.contractIds.length) {
      throw new Error('目标阶梯合同数量发生变化，清理事务已回滚');
    }
    counts.contracts = contractDelete.count;
  }

  private async recalculateRooms(
    tx: CleanupDb,
    roomIds: number[],
  ): Promise<void> {
    for (const roomId of roomIds) {
      const room = await tx.room.findUnique({
        where: { id: roomId },
        select: { id: true, roomStatus: true },
      });
      if (!room || PRESERVED_ROOM_STATUSES.has(room.roomStatus)) continue;
      const remainingContracts = await tx.contract.findMany({
        where: {
          roomId,
          pricingMode: 'FIXED',
          status: { in: ['PENDING_START', 'ACTIVE', 'PENDING_CHECKOUT'] },
        },
        select: { status: true },
      });
      const statuses = new Set(remainingContracts.map((item) => item.status));
      const nextStatus: RoomStatus = statuses.has('PENDING_CHECKOUT')
        ? 'PENDING_CHECKOUT'
        : statuses.has('ACTIVE')
          ? 'RENTED'
          : statuses.has('PENDING_START')
            ? 'PENDING_MOVE_IN'
            : 'EMPTY';
      if (room.roomStatus === nextStatus) continue;
      const changedAt = new Date();
      await tx.room.update({
        where: { id: roomId },
        data: { roomStatus: nextStatus, statusChangedAt: changedAt },
      });
      await tx.roomStatusHistory.create({
        data: {
          roomId,
          fromStatus: room.roomStatus,
          toStatus: nextStatus,
          changeReason: '历史阶梯合同受控清理后重算房态',
          businessType: 'SYSTEM_CLEANUP',
          changedAt,
        },
      });
    }
  }

  private async deleteOrphanFileAssets(
    tx: CleanupDb,
    scope: CleanupScope,
    counts: Record<string, number>,
  ): Promise<Array<{ id: number; storageKey: string }>> {
    if (scope.fileAssetIds.length === 0) {
      counts.file_assets = 0;
      return [];
    }
    const orphanFiles = await tx.fileAsset.findMany({
      where: this.unreferencedFileWhere(scope.fileAssetIds),
      select: { id: true, storageKey: true },
    });
    counts.file_assets = (
      await tx.fileAsset.deleteMany({
        where: { id: { in: orphanFiles.map((item) => item.id) } },
      })
    ).count;
    return orphanFiles;
  }

  private unreferencedFileWhere(fileAssetIds: number[]) {
    return {
      id: { in: fileAssetIds },
      tenantFiles: { none: {} },
      exportTasks: { none: {} },
      contractFiles: { none: {} },
      pricingRebateFiles: { none: {} },
      paymentFiles: { none: {} },
      checkoutSettlementItemFiles: { none: {} },
      depositRefundFiles: { none: {} },
    } satisfies Prisma.FileAssetWhereInput;
  }

  private roomHistoryWhere(
    scope: CleanupScope,
  ): Prisma.RoomStatusHistoryWhereInput {
    return {
      OR: [
        { businessType: 'CONTRACT', businessId: { in: scope.contractIds } },
        { businessType: 'CHECKOUT', businessId: { in: scope.settlementIds } },
        {
          businessType: 'DEPOSIT_REFUND',
          businessId: { in: scope.depositRefundIds },
        },
      ],
    };
  }

  private async removePhysicalFiles(
    files: Array<{ id: number; storageKey: string }>,
  ): Promise<string[]> {
    const uploadRoot = resolve(process.cwd(), '..', 'uploads');
    const manualCleanup: string[] = [];
    for (const file of files) {
      const path = resolve(uploadRoot, file.storageKey);
      const pathFromRoot = relative(uploadRoot, path);
      if (pathFromRoot.startsWith('..') || isAbsolute(pathFromRoot)) {
        manualCleanup.push(file.storageKey);
        continue;
      }
      try {
        await unlink(path);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          manualCleanup.push(file.storageKey);
        }
      }
    }
    return manualCleanup;
  }
}
