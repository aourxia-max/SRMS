import { Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, rgb } from 'pdf-lib';
import { readFile } from 'fs/promises';
import type { AuthUser } from '../auth/auth-user.type';
import { SystemService } from '../system/system.service';
import { FinanceService } from './finance.service';
import { CommissionsService } from './commissions.service';

const value = (
  input: { toString(): string } | string | number | boolean | null | undefined,
) => (input === null || input === undefined ? '' : input.toString());

@Injectable()
export class FinanceExportService {
  constructor(
    private readonly finance: FinanceService,
    private readonly system: SystemService,
    private readonly commissions: CommissionsService,
  ) {}

  async rentCollectionWorkbook(
    from: string | undefined,
    to: string | undefined,
    user: AuthUser,
  ) {
    const report = await this.finance.rentCollection(from, to);
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('租金收缴报表');
    this.header(sheet, '租金收缴报表（账期经营口径）', from, to, user);
    sheet.addRow([
      '账单编号',
      '合同编号',
      '房号',
      '承租人',
      '账期开始',
      '原应收',
      '优惠减免',
      '净应收',
      '有效实收',
      '未收',
      '状态',
    ]);
    report.rows.forEach((row) =>
      sheet.addRow([
        row.billNo,
        row.contractNo,
        row.houseNo,
        row.tenantName,
        row.periodStart.toISOString().slice(0, 10),
        value(row.originalReceivable),
        value(row.concessionAmount),
        value(row.netReceivable),
        value(row.validReceived),
        value(row.outstanding),
        row.status,
      ]),
    );
    sheet.addRow([
      '合计',
      '',
      '',
      '',
      '',
      value(report.total.originalReceivable),
      value(report.total.concessionAmount),
      value(report.total.netReceivable),
      value(report.total.validReceived),
      value(report.total.outstanding),
      report.collectionRate === null
        ? '收租率：—'
        : `收租率：${value(report.collectionRate)}%`,
    ]);
    this.style(sheet, 11);
    await this.system.recordFinancialExport(user, 'RENT_COLLECTION_XLSX', {
      from: from ?? null,
      to: to ?? null,
    });
    return workbook.xlsx.writeBuffer();
  }

  async cashFlowWorkbook(
    from: string | undefined,
    to: string | undefined,
    user: AuthUser,
  ) {
    const report = await this.finance.cashFlows(from, to);
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('资金流水');
    this.header(sheet, '资金流水（实际收付日期口径）', from, to, user);
    sheet.addRow([
      '发生日期',
      '类型',
      '金额',
      '方向',
      '外部现金流',
      '计入租金实收',
      '业务编号',
    ]);
    report.flows.forEach((row) =>
      sheet.addRow([
        row.date.toISOString().slice(0, 10),
        row.type,
        value(row.amount),
        row.direction === 'IN' ? '流入' : '流出',
        row.external ? '是' : '否（内部抵扣）',
        row.countsAsRentReceipt ? '是' : '否',
        row.reference,
      ]),
    );
    sheet.addRow([
      '合计',
      '',
      `流入：${value(report.inflow)}`,
      `流出：${value(report.outflow)}`,
      `净资金流：${value(report.netCashFlow)}`,
    ]);
    this.style(sheet, 7);
    await this.system.recordFinancialExport(user, 'CASH_FLOW_XLSX', {
      from: from ?? null,
      to: to ?? null,
    });
    return workbook.xlsx.writeBuffer();
  }

  async rentCollectionPdf(
    from: string | undefined,
    to: string | undefined,
    user: AuthUser,
  ) {
    const report = await this.finance.rentCollection(from, to);
    const rows = report.rows.map((row) => [
      row.billNo,
      row.houseNo,
      row.tenantName,
      value(row.netReceivable),
      value(row.validReceived),
      value(row.outstanding),
    ]);
    const file = await this.tablePdf(
      '租金收缴报表（账期经营口径）',
      ['账单', '房号', '承租人', '净应收', '有效实收', '未收'],
      rows,
      from,
      to,
      user,
    );
    await this.system.recordFinancialExport(user, 'RENT_COLLECTION_PDF', {
      from: from ?? null,
      to: to ?? null,
    });
    return file;
  }

  async cashFlowPdf(
    from: string | undefined,
    to: string | undefined,
    user: AuthUser,
  ) {
    const report = await this.finance.cashFlows(from, to);
    const rows = report.flows.map((row) => [
      row.date.toISOString().slice(0, 10),
      row.type,
      value(row.amount),
      row.direction === 'IN' ? '流入' : '流出',
      row.external ? '外部' : '内部抵扣',
      row.reference,
    ]);
    const file = await this.tablePdf(
      '资金流水（实际收付日期口径）',
      ['日期', '类型', '金额', '方向', '现金流', '业务编号'],
      rows,
      from,
      to,
      user,
    );
    await this.system.recordFinancialExport(user, 'CASH_FLOW_PDF', {
      from: from ?? null,
      to: to ?? null,
    });
    return file;
  }

  async overviewPdf(
    from: string | undefined,
    to: string | undefined,
    user: AuthUser,
  ) {
    const [collection, cash] = await Promise.all([
      this.finance.rentCollection(from, to),
      this.finance.cashFlows(from, to),
    ]);
    const file = await this.tablePdf(
      '财务总览',
      ['指标', '金额/结果'],
      [
        ['原应收', value(collection.total.originalReceivable)],
        ['优惠减免', value(collection.total.concessionAmount)],
        ['租金净应收', value(collection.total.netReceivable)],
        ['有效实收', value(collection.total.validReceived)],
        ['未收', value(collection.total.outstanding)],
        [
          '收租率',
          collection.collectionRate === null
            ? '—'
            : `${value(collection.collectionRate)}%`,
        ],
        ['外部资金流入', value(cash.inflow)],
        ['外部资金流出', value(cash.outflow)],
        ['净资金流', value(cash.netCashFlow)],
      ],
      from,
      to,
      user,
    );
    await this.system.recordFinancialExport(user, 'FINANCE_OVERVIEW_PDF', {
      from: from ?? null,
      to: to ?? null,
    });
    return file;
  }

  async commissionsWorkbook(user: AuthUser) {
    const items = await this.commissions.list();
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('租房提成台账');
    this.header(
      sheet,
      '租房提成台账（内部登记，不代表已付款）',
      undefined,
      undefined,
      user,
    );
    sheet.addRow([
      '合同编号',
      '房号',
      '所属对象',
      '提成金额',
      '创建时间',
      '更新时间',
    ]);
    items.forEach((item) =>
      sheet.addRow([
        item.contract.contractNo,
        item.contract.room.fullHouseNo,
        item.recipientName,
        value(item.amount),
        item.createdAt.toISOString().slice(0, 19).replace('T', ' '),
        item.updatedAt.toISOString().slice(0, 19).replace('T', ' '),
      ]),
    );
    this.style(sheet, 6);
    await this.system.recordFinancialExport(user, 'COMMISSIONS_XLSX', {});
    return workbook.xlsx.writeBuffer();
  }

  private header(
    sheet: ExcelJS.Worksheet,
    title: string,
    from: string | undefined,
    to: string | undefined,
    user: AuthUser,
  ) {
    sheet.mergeCells('A1:K1');
    sheet.getCell('A1').value = title;
    sheet.getCell('A1').font = { bold: true, size: 14 };
    sheet.mergeCells('A2:K2');
    sheet.getCell('A2').value =
      `统计期间：${from ?? '全部'} 至 ${to ?? '全部'}；生成时间：${new Date().toLocaleString('zh-CN')}；操作人：${user.displayName}`;
  }
  private style(sheet: ExcelJS.Worksheet, columns: number) {
    sheet.getRow(3).font = { bold: true };
    sheet.getRow(3).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'E8F3FF' },
    };
    sheet.columns.forEach((column) => {
      column.width = 16;
    });
    sheet.getColumn(columns).width = 20;
  }

  private async tablePdf(
    title: string,
    headers: string[],
    rows: string[][],
    from: string | undefined,
    to: string | undefined,
    user: AuthUser,
  ) {
    const pdf = await PDFDocument.create();
    pdf.registerFontkit(fontkit);
    const fontPath =
      process.env.PDF_FONT_PATH ?? 'C:\\Windows\\Fonts\\NotoSansSC-VF.ttf';
    const font = await pdf.embedFont(await readFile(fontPath), {
      subset: true,
    });
    const page = pdf.addPage([842, 595]);
    const { width, height } = page.getSize();
    const margin = 32;
    const columnWidth = (width - margin * 2) / headers.length;
    let y = height - margin;
    const draw = (
      text: string,
      x: number,
      size = 8,
      color = rgb(0.12, 0.15, 0.2),
    ) => page.drawText(text.slice(0, 28), { x, y, size, font, color });
    draw(title, margin, 16);
    y -= 24;
    draw(
      `统计期间：${from ?? '全部'} 至 ${to ?? '全部'}；生成时间：${new Date().toLocaleString('zh-CN')}；操作人：${user.displayName}`,
      margin,
      7,
    );
    y -= 22;
    headers.forEach((header, index) =>
      draw(header, margin + index * columnWidth, 8, rgb(0.1, 0.34, 0.65)),
    );
    y -= 14;
    for (const row of rows.slice(0, 35)) {
      row.forEach((cell, index) => draw(cell, margin + index * columnWidth));
      y -= 13;
    }
    if (rows.length > 35)
      draw(
        `注：共 ${rows.length} 条，PDF 仅展示前 35 条；请使用 Excel 查看完整明细。`,
        margin,
        7,
        rgb(0.75, 0.25, 0.2),
      );
    return pdf.save();
  }
}
