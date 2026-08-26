import ExcelJS from 'exceljs';
import { PDFDocument } from 'pdf-lib';
import { Prisma, UserRole } from '@prisma/client';
import { FinanceExportService } from './finance-export.service';

describe('FinanceExportService cash-flow labels and references', () => {
  const user = {
    id: 1,
    username: 'root',
    displayName: 'root',
    role: UserRole.SUPER_ADMIN,
  };
  const report = {
    flows: [
      {
        date: new Date('2026-08-10T02:00:00.000Z'),
        flowType: 'PAYMENT',
        type: '租金收款',
        amount: new Prisma.Decimal('120.00'),
        direction: 'IN',
        external: true,
        countsAsRentReceipt: true,
        reference: 'SK-31',
        requestNo: null,
        contractNo: null,
        category: null,
        correctionOccurredAt: null,
        originalOccurredAt: new Date('2026-08-10T02:00:00.000Z'),
        source: { entityType: 'Payment', entityId: 31 },
        generatedSource: null,
      },
      {
        date: new Date('2026-08-26T10:00:00.000Z'),
        flowType: 'CONTRACT_VOID_REVERSAL',
        type: '合同纠错冲销',
        amount: new Prisma.Decimal('-120.00'),
        direction: 'OUT',
        external: false,
        countsAsRentReceipt: false,
        reference: 'HTZF202608260001',
        requestNo: 'HTZF202608260001',
        contractNo: 'HT20260001',
        category: 'PAYMENT',
        correctionOccurredAt: new Date('2026-08-26T10:00:00.000Z'),
        originalOccurredAt: new Date('2026-08-10T02:00:00.000Z'),
        source: { entityType: 'Payment', entityId: 31 },
        generatedSource: null,
      },
    ],
    inflow: new Prisma.Decimal('120.00'),
    outflow: new Prisma.Decimal('0.00'),
    netCashFlow: new Prisma.Decimal('120.00'),
  };

  function service(cashFlowReport: unknown = report) {
    return new FinanceExportService(
      { cashFlows: jest.fn().mockResolvedValue(cashFlowReport) } as never,
      { recordFinancialExport: jest.fn().mockResolvedValue({}) } as never,
      {} as never,
    );
  }

  it('writes Chinese categories and separates business and correction numbers in Excel', async () => {
    const bytes = await service().cashFlowWorkbook(undefined, undefined, user);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(bytes);
    const rows = workbook.getWorksheet('资金流水')!.getRows(3, 3)!;

    expect(rows[0].values).toEqual([
      undefined,
      '发生日期',
      '原业务日期',
      '流水类型',
      '类别',
      '金额',
      '方向',
      '外部现金流',
      '计入租金实收',
      '业务编号',
      '纠错单号',
      '合同编号',
      '原始来源',
      '生成来源',
    ]);
    expect(rows[1].values).toEqual([
      undefined,
      '2026-08-10',
      '2026-08-10',
      '租金收款',
      '',
      '120',
      '流入',
      '是',
      '是',
      'SK-31',
      '',
      '',
      'Payment#31',
      '',
    ]);
    expect(rows[2].values).toEqual([
      undefined,
      '2026-08-26',
      '2026-08-10',
      '合同纠错冲销',
      '收款',
      '-120',
      '流出',
      '否（内部抵扣）',
      '否',
      '',
      'HTZF202608260001',
      'HT20260001',
      'Payment#31',
      '',
    ]);
  });

  it('maps every correction category to a Chinese export label', async () => {
    const categories = [
      ['RENT_BILL', '租金账单'],
      ['PAYMENT', '收款'],
      ['PAYMENT_ALLOCATION', '收款分配'],
      ['PREPAYMENT', '预收款'],
      ['DEPOSIT', '押金'],
      ['REFUND', '退款'],
      ['ADJUSTMENT', '账单调整'],
      ['PRICING_REBATE', '固定月租退差'],
      ['CHECKOUT', '退租结算'],
      ['COMMISSION', '租房提成'],
      ['ROOM_STATUS', '房间状态'],
    ] as const;
    const allCategoriesReport = {
      ...report,
      flows: categories.map(([category], index) => ({
        ...report.flows[1],
        category,
        source: { entityType: 'ContractVoidReversal', entityId: index + 1 },
      })),
    };

    const bytes = await service(allCategoriesReport).cashFlowWorkbook(
      undefined,
      undefined,
      user,
    );
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(bytes);
    const rows = workbook
      .getWorksheet('资金流水')!
      .getRows(4, categories.length)!;

    expect(rows.map((row) => row.getCell(4).value)).toEqual(
      categories.map(([, label]) => label),
    );
    expect(rows.map((row) => row.getCell(4).value)).not.toEqual(
      categories.map(([category]) => category),
    );
  });
  it('passes the same Chinese labels and split references to PDF and returns a readable PDF', async () => {
    const exportService = service();
    const tablePdf = jest
      .spyOn(exportService as never, 'tablePdf')
      .mockResolvedValue(new Uint8Array([1, 2, 3]));

    await exportService.cashFlowPdf(undefined, undefined, user);

    expect(tablePdf).toHaveBeenCalledWith(
      '资金流水（纠错发生日期口径）',
      [
        '发生日期',
        '原业务日期',
        '类型',
        '类别',
        '金额',
        '方向',
        '业务编号',
        '纠错单号',
        '合同编号',
        '原始来源',
        '生成来源',
      ],
      [
        [
          '2026-08-10',
          '2026-08-10',
          '租金收款',
          '',
          '120',
          '流入',
          'SK-31',
          '',
          '',
          'Payment#31',
          '',
        ],
        [
          '2026-08-26',
          '2026-08-10',
          '合同纠错冲销',
          '收款',
          '-120',
          '流出',
          '',
          'HTZF202608260001',
          'HT20260001',
          'Payment#31',
          '',
        ],
      ],
      undefined,
      undefined,
      user,
    );

    tablePdf.mockRestore();
    const pdfBytes = await exportService.cashFlowPdf(
      undefined,
      undefined,
      user,
    );
    const pdf = await PDFDocument.load(pdfBytes);
    expect(pdf.getPageCount()).toBe(1);
  });
});
