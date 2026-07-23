import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  BackupStatus,
  BackupType,
  Prisma,
  RestoreStatus,
  SettingValueType,
  UserRole,
} from '@prisma/client';
import { createHash } from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { unlink } from 'fs/promises';
import { join, resolve } from 'path';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import type { AuthUser } from '../auth/auth-user.type';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateSettingsDto } from './dto/update-settings.dto';

const DEFAULTS: Record<
  string,
  { value: Prisma.InputJsonValue; type: SettingValueType; description: string }
> = {
  projectName: {
    value: 'SRMS 房屋租赁管理系统',
    type: 'STRING',
    description: '系统项目名称',
  },
  rentReminderDays: {
    value: 7,
    type: 'INTEGER',
    description: '租金到期提醒提前天数',
  },
  contractExpiryDays: {
    value: 30,
    type: 'INTEGER',
    description: '合同到期提醒提前天数',
  },
  longVacancyDays: {
    value: 30,
    type: 'INTEGER',
    description: '长期空置预警天数',
  },
  receiptPrefix: { value: 'SRMS', type: 'STRING', description: '收据编号前缀' },
  uploadSizeLimitMb: {
    value: 20,
    type: 'INTEGER',
    description: '单文件上传大小上限（MB）',
  },
  defaultTenantType: {
    value: 'INDIVIDUAL',
    type: 'STRING',
    description: '默认租客类型',
  },
  defaultPaymentCycle: {
    value: 'MONTHLY',
    type: 'STRING',
    description: '默认支付周期',
  },
};

@Injectable()
export class SystemService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async settings() {
    const rows = await this.prisma.db.systemSetting.findMany();
    const values: Record<string, Prisma.JsonValue> = Object.fromEntries(
      rows.map((row) => [row.settingKey, row.settingValue]),
    );
    return Object.fromEntries(
      Object.entries(DEFAULTS).map(([key, item]) => [
        key,
        values[key] ?? item.value,
      ]),
    );
  }

  async businessDefaults() {
    const settings = await this.settings();
    return {
      defaultTenantType: settings.defaultTenantType,
      defaultPaymentCycle: settings.defaultPaymentCycle,
    };
  }

  async publicInfo() {
    const settings = await this.settings();
    return { projectName: settings.projectName };
  }

  async recordFinancialExport(
    user: AuthUser,
    report: string,
    filters: Prisma.InputJsonValue,
  ) {
    await this.prisma.db.$transaction((tx) =>
      this.appendAudit(
        tx,
        'FINANCE_REPORT_EXPORTED',
        'FINANCE_REPORT',
        null,
        user,
        {
          report,
          filters,
        },
      ),
    );
  }

  async updateSettings(dto: UpdateSettingsDto, user: AuthUser) {
    const before = await this.settings();
    await this.prisma.db.$transaction(async (tx) => {
      for (const [key, item] of Object.entries(DEFAULTS)) {
        await tx.systemSetting.upsert({
          where: { settingKey: key },
          create: {
            settingKey: key,
            settingValue: dto[key as keyof UpdateSettingsDto],
            valueType: item.type,
            description: item.description,
            updatedBy: user.id,
          },
          update: {
            settingValue: dto[key as keyof UpdateSettingsDto],
            updatedBy: user.id,
          },
        });
      }
      await tx.operationLog.create({
        data: {
          module: 'SYSTEM',
          action: 'UPDATE_SETTINGS',
          entityType: 'SYSTEM_SETTING',
          summary: '更新系统参数',
          beforeData: before,
          afterData: dto as unknown as Prisma.InputJsonValue,
          operatorId: user.id,
          operatorRole: user.role,
        },
      });
      await this.appendAudit(
        tx,
        'SYSTEM_SETTINGS_UPDATED',
        'SYSTEM_SETTING',
        null,
        user,
        { before, after: dto as unknown as Prisma.InputJsonObject },
      );
    });
    return this.settings();
  }

  async listOperations(
    query: Record<string, string | undefined>,
    user: AuthUser,
  ) {
    const where: Prisma.OperationLogWhereInput = {
      ...(user.role === UserRole.SUPER_ADMIN
        ? {}
        : { operatorId: user.id, isHidden: false }),
    };
    if (query.module) where.module = query.module;
    if (query.action) where.action = query.action;
    if (query.keyword)
      where.OR = [
        { summary: { contains: query.keyword } },
        { entityNo: { contains: query.keyword } },
      ];
    const rows = await this.prisma.db.operationLog.findMany({
      where,
      orderBy: { occurredAt: 'desc' },
      take: Math.min(Number(query.limit) || 100, 200),
    });
    return rows.map((row) =>
      user.role === UserRole.SUPER_ADMIN
        ? row
        : {
            id: row.id,
            module: row.module,
            action: row.action,
            summary: row.summary,
            occurredAt: row.occurredAt,
          },
    );
  }

  async hideOperation(
    id: number,
    reason: string,
    user: AuthUser,
    restore = false,
  ) {
    const log = await this.prisma.db.operationLog.findUnique({ where: { id } });
    if (!log) throw new NotFoundException('操作日志不存在');
    await this.prisma.db.$transaction(async (tx) => {
      await tx.operationLog.update({
        where: { id },
        data: restore
          ? {
              isHidden: false,
              hiddenBy: null,
              hiddenAt: null,
              hiddenReason: null,
            }
          : {
              isHidden: true,
              hiddenBy: user.id,
              hiddenAt: new Date(),
              hiddenReason: reason,
            },
      });
      await this.appendAudit(
        tx,
        restore ? 'OPERATION_LOG_RESTORED' : 'OPERATION_LOG_HIDDEN',
        'OPERATION_LOG',
        id,
        user,
        { reason },
      );
    });
  }

  async listAudits() {
    return this.prisma.db.securityAuditLog.findMany({
      orderBy: { occurredAt: 'desc' },
      take: 200,
    });
  }
  async verifyAudits() {
    const rows = await this.prisma.db.securityAuditLog.findMany({
      orderBy: { id: 'asc' },
    });
    let previous: string | null = null;
    const invalid: number[] = [];
    for (const row of rows) {
      if (!row.recordHash) continue;
      const payload = JSON.stringify({
        eventType: row.eventType,
        entityType: row.entityType,
        entityId: row.entityId,
        operatorId: row.operatorId,
        eventData: row.eventData,
        reason: row.reason,
        occurredAt: row.occurredAt.toISOString(),
        previousHash: row.previousHash,
      });
      const expected = createHash('sha256').update(payload).digest('hex');
      if (row.previousHash !== previous || row.recordHash !== expected)
        invalid.push(row.id);
      previous = row.recordHash;
    }
    return {
      valid: invalid.length === 0,
      invalidIds: invalid,
      total: rows.length,
    };
  }

  async listBackups() {
    return this.prisma.db.backupRecord.findMany({
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }
  async createBackup(user: AuthUser) {
    const now = new Date();
    const no = `BK-${now
      .toISOString()
      .replace(/[-:.TZ]/g, '')
      .slice(0, 14)}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
    const record = await this.prisma.db.backupRecord.create({
      data: {
        backupNo: no,
        backupType: BackupType.MANUAL,
        status: BackupStatus.RUNNING,
        retentionUntil: new Date(now.getTime() + 30 * 86400000),
        createdBy: user.id,
        startedAt: now,
      },
    });
    try {
      const databaseUrl = this.config.getOrThrow<string>('DATABASE_URL');
      const backupDir = this.config.getOrThrow<string>('BACKUP_DIR');
      const dumpPath = this.config.getOrThrow<string>('MYSQLDUMP_PATH');
      const url = new URL(databaseUrl);
      const databasePath = resolve(backupDir, `${no}.sql`);
      if (!databasePath.startsWith(resolve(backupDir)))
        throw new BadRequestException('备份目录配置无效');
      await mkdir(backupDir, { recursive: true });
      const args = [
        `--host=${url.hostname}`,
        `--port=${url.port || 3306}`,
        `--user=${decodeURIComponent(url.username)}`,
        `--password=${decodeURIComponent(url.password)}`,
        '--single-transaction',
        '--routines',
        '--events',
        `--result-file=${databasePath}`,
        url.pathname.slice(1),
      ];
      await promisify(execFile)(dumpPath, args, { windowsHide: true });
      const content = await readFile(databasePath);
      const attachmentPath = join(backupDir, `${no}.attachments.zip`);
      const uploadsDir = resolve(process.cwd(), '..', 'uploads');
      await promisify(execFile)(
        'tar.exe',
        ['-a', '-c', '-f', attachmentPath, '-C', uploadsDir, '.'],
        { windowsHide: true },
      );
      const attachment = await readFile(attachmentPath);
      const manifestPath = join(backupDir, `${no}.manifest.json`);
      await writeFile(
        manifestPath,
        JSON.stringify(
          {
            backupNo: no,
            database: url.pathname.slice(1),
            generatedAt: new Date().toISOString(),
            attachmentArchive: attachmentPath,
            attachmentSha256: createHash('sha256')
              .update(attachment)
              .digest('hex'),
          },
          null,
          2,
        ),
        'utf8',
      );
      await this.prisma.db.backupRecord.update({
        where: { id: record.id },
        data: {
          status: BackupStatus.SUCCESS,
          databasePath,
          manifestPath,
          sizeBytes: BigInt(content.length + attachment.length),
          checksum: createHash('sha256').update(content).digest('hex'),
          completedAt: new Date(),
        },
      });
    } catch (error) {
      await this.prisma.db.backupRecord.update({
        where: { id: record.id },
        data: {
          status: BackupStatus.FAILED,
          completedAt: new Date(),
          failureReason:
            error instanceof Error
              ? error.message.slice(0, 500)
              : '备份执行失败',
        },
      });
    }
    const result = await this.prisma.db.backupRecord.findUniqueOrThrow({
      where: { id: record.id },
    });
    await this.prisma.db.$transaction(async (tx) => {
      await tx.operationLog.create({
        data: {
          module: 'SYSTEM',
          action: 'CREATE_BACKUP',
          entityType: 'BACKUP',
          entityId: record.id,
          entityNo: no,
          summary:
            result.status === BackupStatus.SUCCESS
              ? '创建数据库手工备份'
              : '创建手工备份失败',
          operatorId: user.id,
          operatorRole: user.role,
        },
      });
      await this.appendAudit(
        tx,
        'BACKUP_CREATION_REQUESTED',
        'BACKUP',
        record.id,
        user,
        { backupNo: no, status: result.status },
      );
    });
    return result;
  }

  @Cron('0 0 2 * * *')
  async runDailyBackup() {
    const operator = await this.prisma.db.user.findFirst({
      where: { role: UserRole.SUPER_ADMIN, status: 'ACTIVE' },
      orderBy: { id: 'asc' },
    });
    if (!operator) return;
    const backup = await this.createBackup(operator);
    await this.prisma.db.backupRecord.update({
      where: { id: backup.id },
      data: { backupType: BackupType.DAILY },
    });
    await this.cleanExpiredBackups();
  }

  async cleanExpiredBackups() {
    const backupDir = resolve(this.config.getOrThrow<string>('BACKUP_DIR'));
    const expired = await this.prisma.db.backupRecord.findMany({
      where: { retentionUntil: { lt: new Date() } },
    });
    for (const item of expired) {
      for (const file of [item.databasePath, item.manifestPath]) {
        if (!file || !resolve(file).startsWith(backupDir)) continue;
        await unlink(file).catch(() => undefined);
      }
      if (item.databasePath) {
        const attachment = item.databasePath.replace(
          /\.sql$/i,
          '.attachments.zip',
        );
        if (resolve(attachment).startsWith(backupDir))
          await unlink(attachment).catch(() => undefined);
      }
      await this.prisma.db.backupRecord.delete({ where: { id: item.id } });
    }
  }
  async restoreBackup(
    id: number,
    reason: string,
    confirmation: string,
    user: AuthUser,
  ) {
    const backup = await this.prisma.db.backupRecord.findUnique({
      where: { id },
    });
    if (!backup || backup.status !== BackupStatus.SUCCESS)
      throw new BadRequestException('只能恢复成功完成的备份');
    if (confirmation !== '确认恢复')
      throw new BadRequestException('请准确输入“确认恢复”后再执行恢复');
    if (!backup.databasePath || !backup.checksum)
      throw new BadRequestException('备份文件或校验值缺失，禁止恢复');
    const content = await readFile(backup.databasePath);
    if (createHash('sha256').update(content).digest('hex') !== backup.checksum)
      throw new BadRequestException('备份校验失败，禁止恢复');
    const preRestore = await this.createBackup(user);
    if (preRestore.status !== BackupStatus.SUCCESS)
      throw new BadRequestException('恢复前自动备份失败，已拒绝恢复');
    await this.prisma.db.backupRecord.update({
      where: { id: preRestore.id },
      data: { backupType: BackupType.PRE_RESTORE },
    });
    await this.prisma.db.backupRecord.update({
      where: { id },
      data: { restoreStatus: RestoreStatus.RUNNING, restoreReason: reason },
    });
    try {
      const databaseUrl = this.config.getOrThrow<string>('DATABASE_URL');
      const mysqlPath = this.config.getOrThrow<string>('MYSQL_PATH');
      const url = new URL(databaseUrl);
      const source = backup.databasePath.replace(/\\/g, '/');
      await promisify(execFile)(
        mysqlPath,
        [
          `--host=${url.hostname}`,
          `--port=${url.port || 3306}`,
          `--user=${decodeURIComponent(url.username)}`,
          `--password=${decodeURIComponent(url.password)}`,
          url.pathname.slice(1),
          `--execute=source ${source}`,
        ],
        { windowsHide: true },
      );
      await this.prisma.db.authRefreshToken.updateMany({
        where: { revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await this.prisma.db.backupRecord.update({
        where: { id },
        data: {
          restoreStatus: RestoreStatus.SUCCESS,
          restoredBy: user.id,
          restoredAt: new Date(),
        },
      });
      await this.appendAudit(
        this.prisma.db,
        'DATABASE_RESTORED',
        'BACKUP',
        backup.id,
        user,
        {
          reason,
          backupNo: backup.backupNo,
          preRestoreBackupNo: preRestore.backupNo,
        },
      );
      return { restored: true, preRestoreBackupNo: preRestore.backupNo };
    } catch (error) {
      await this.prisma.db.backupRecord.update({
        where: { id },
        data: {
          restoreStatus: RestoreStatus.FAILED,
          restoreReason:
            error instanceof Error
              ? `${reason}；失败：${error.message}`.slice(0, 500)
              : reason,
        },
      });
      throw new BadRequestException(
        '恢复执行失败；恢复前备份已保留，请核对失败原因后再处理',
      );
    }
  }

  private async appendAudit(
    tx: Prisma.TransactionClient,
    eventType: string,
    entityType: string,
    entityId: number | null,
    user: AuthUser,
    eventData: Prisma.InputJsonValue,
  ) {
    const last = await tx.securityAuditLog.findFirst({
      where: { recordHash: { not: null } },
      orderBy: { id: 'desc' },
    });
    const occurredAt = new Date();
    const previousHash = last?.recordHash ?? null;
    const payload = JSON.stringify({
      eventType,
      entityType,
      entityId,
      operatorId: user.id,
      eventData,
      reason: null,
      occurredAt: occurredAt.toISOString(),
      previousHash,
    });
    const recordHash = createHash('sha256').update(payload).digest('hex');
    await tx.securityAuditLog.create({
      data: {
        eventType,
        entityType,
        entityId,
        operatorId: user.id,
        eventData,
        occurredAt,
        previousHash,
        recordHash,
      },
    });
  }
}
