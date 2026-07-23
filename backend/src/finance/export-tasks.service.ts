import { Injectable, NotFoundException } from '@nestjs/common';
import { ExportFormat, ExportTaskStatus, FileCategory } from '@prisma/client';
import { createHash, randomUUID } from 'crypto';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { resolve } from 'path';
import type { AuthUser } from '../auth/auth-user.type';
import { PrismaService } from '../prisma/prisma.service';
import { FinanceExportService } from './finance-export.service';

type ReportType = 'overview' | 'rent-collection' | 'cash-flows' | 'commissions';

@Injectable()
export class ExportTasksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly exports: FinanceExportService,
  ) {}
  async create(
    reportType: ReportType,
    format: ExportFormat,
    filters: { from?: string; to?: string },
    user: AuthUser,
  ) {
    const task = await this.prisma.db.exportTask.create({
      data: {
        taskNo: `EX-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
        reportType,
        exportFormat: format,
        filters,
        createdBy: user.id,
      },
    });
    setImmediate(() => void this.run(task.id, user));
    return task;
  }
  async list(user: AuthUser) {
    return this.prisma.db.exportTask.findMany({
      where: { createdBy: user.id },
      include: { fileAsset: true },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }
  async content(id: number, user: AuthUser) {
    const task = await this.prisma.db.exportTask.findFirst({
      where: { id, createdBy: user.id, status: ExportTaskStatus.SUCCESS },
      include: { fileAsset: true },
    });
    if (!task?.fileAsset)
      throw new NotFoundException('导出文件不存在或尚未完成');
    return {
      task,
      content: await readFile(
        resolve(
          process.cwd(),
          '..',
          'uploads',
          'exports',
          task.fileAsset.storedName,
        ),
      ),
    };
  }
  private async run(id: number, user: AuthUser) {
    await this.prisma.db.exportTask.update({
      where: { id },
      data: { status: ExportTaskStatus.RUNNING, startedAt: new Date() },
    });
    try {
      const task = await this.prisma.db.exportTask.findUniqueOrThrow({
        where: { id },
      });
      const filters = task.filters as { from?: string; to?: string };
      const file = await this.generate(
        task.reportType as ReportType,
        task.exportFormat,
        filters,
        user,
      );
      const extension =
        task.exportFormat === ExportFormat.XLSX ? '.xlsx' : '.pdf';
      const storedName = `${randomUUID()}${extension}`;
      const folder = resolve(process.cwd(), '..', 'uploads', 'exports');
      await mkdir(folder, { recursive: true });
      const path = resolve(folder, storedName);
      const bytes = new Uint8Array(file);
      await writeFile(path, bytes);
      const content = await readFile(path);
      const asset = await this.prisma.db.fileAsset.create({
        data: {
          storageKey: `exports/${storedName}`,
          originalName: `${task.reportType}-${task.taskNo}${extension}`,
          storedName,
          mimeType:
            task.exportFormat === ExportFormat.XLSX
              ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
              : 'application/pdf',
          extension,
          sizeBytes: BigInt(content.length),
          sha256: createHash('sha256').update(content).digest('hex'),
          category: FileCategory.FINANCE_EXPORT,
          uploadedBy: user.id,
        },
      });
      await this.prisma.db.exportTask.update({
        where: { id },
        data: {
          status: ExportTaskStatus.SUCCESS,
          fileAssetId: asset.id,
          completedAt: new Date(),
        },
      });
    } catch (error) {
      await this.prisma.db.exportTask.update({
        where: { id },
        data: {
          status: ExportTaskStatus.FAILED,
          completedAt: new Date(),
          failureReason:
            error instanceof Error ? error.message.slice(0, 500) : '导出失败',
        },
      });
    }
  }
  private generate(
    report: ReportType,
    format: ExportFormat,
    filters: { from?: string; to?: string },
    user: AuthUser,
  ) {
    if (report === 'commissions') return this.exports.commissionsWorkbook(user);
    if (report === 'overview' && format === ExportFormat.PDF)
      return this.exports.overviewPdf(filters.from, filters.to, user);
    if (report === 'rent-collection')
      return format === ExportFormat.XLSX
        ? this.exports.rentCollectionWorkbook(filters.from, filters.to, user)
        : this.exports.rentCollectionPdf(filters.from, filters.to, user);
    if (report === 'cash-flows')
      return format === ExportFormat.XLSX
        ? this.exports.cashFlowWorkbook(filters.from, filters.to, user)
        : this.exports.cashFlowPdf(filters.from, filters.to, user);
    throw new Error('不支持的导出类型');
  }
}
