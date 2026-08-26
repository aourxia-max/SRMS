import ExcelJS from 'exceljs';
import { Prisma, UserRole } from '@prisma/client';
import { FinanceExportService } from './finance-export.service';

describe('FinanceExportService contract correction cash flow', () => {
  it('exports the same correction label, signed amount, dates and source links as detail', async () => {
    const correctionOccurredAt = new Date('2026-08-26T10:00:00.000Z');
    const originalOccurredAt = new Date('2026-08-02T09:00:00.000Z');
    const finance = {
      cashFlows: jest.fn().mockResolvedValue({
        flows: [
          {
            date: correctionOccurredAt,
            flowType: 'CONTRACT_VOID_REVERSAL',
            type: '\u5408\u540c\u7ea0\u9519\u51b2\u9500',
            amount: new Prisma.Decimal('-120.00'),
            direction: 'OUT',
            external: false,
            countsAsRentReceipt: false,
            reference: 'HTZF202608260001',
            requestNo: 'HTZF202608260001',
            contractNo: 'HT20260001',
            category: 'PAYMENT',
            correctionOccurredAt,
            originalOccurredAt,
            source: { entityType: 'Payment', entityId: 31 },
            generatedSource: null,
          },
        ],
        inflow: new Prisma.Decimal('0.00'),
        outflow: new Prisma.Decimal('0.00'),
        netCashFlow: new Prisma.Decimal('0.00'),
      }),
    };
    const system = { recordFinancialExport: jest.fn().mockResolvedValue({}) };
    const service = new FinanceExportService(
      finance as never,
      system as never,
      {} as never,
    );

    const bytes = await service.cashFlowWorkbook(undefined, undefined, {
      id: 1,
      username: 'root',
      displayName: 'root',
      role: UserRole.SUPER_ADMIN,
    });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(bytes);
    const rows = workbook
      .getWorksheet('\u8d44\u91d1\u6d41\u6c34')!
      .getRows(3, 2)!;

    expect(rows[0].values).toEqual([
      undefined,
      '\u53d1\u751f\u65e5\u671f',
      '\u539f\u4e1a\u52a1\u65e5\u671f',
      '\u6d41\u6c34\u7c7b\u578b',
      '\u7c7b\u522b',
      '\u91d1\u989d',
      '\u65b9\u5411',
      '\u5916\u90e8\u73b0\u91d1\u6d41',
      '\u8ba1\u5165\u79df\u91d1\u5b9e\u6536',
      '\u7ea0\u9519\u5355\u53f7',
      '\u5408\u540c\u7f16\u53f7',
      '\u539f\u59cb\u6765\u6e90',
      '\u751f\u6210\u6765\u6e90',
    ]);
    expect(rows[1].values).toEqual([
      undefined,
      '2026-08-26',
      '2026-08-02',
      '\u5408\u540c\u7ea0\u9519\u51b2\u9500',
      'PAYMENT',
      '-120',
      '\u6d41\u51fa',
      '\u5426\uff08\u5185\u90e8\u62b5\u6263\uff09',
      '\u5426',
      'HTZF202608260001',
      'HT20260001',
      'Payment#31',
      '',
    ]);
  });
});
