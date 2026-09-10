import { FinanceService } from './finance.service';
import { Prisma } from '@prisma/client';

describe('FinanceService rent collection category isolation', () => {
  function checkoutFixture() {
    const settlement = {
      status: 'DRAFT',
      actualCheckoutDate: new Date('2026-09-01'),
    };
    const contract = {
      contractNo: 'HT-CUTOFF',
      room: { fullHouseNo: '1-101' },
      members: [],
      checkoutSettlements: [settlement],
    };
    const payments = [200, 1600, 600].map((amount, index) => ({
      id: index + 1,
      amount: new Prisma.Decimal(amount),
      receiptNo: `SK-${index}`,
      paymentCategory: 'RENT',
      status: 'CONFIRMED',
      paymentDate: new Date('2026-08-20'),
    }));
    const allocation = (index: number) => ({
      allocatedAmount: payments[index].amount,
      reversedAmount: new Prisma.Decimal(0),
      payment: payments[index],
    });
    const rows = [
      {
        billNo: 'EQUAL',
        periodStart: new Date('2026-09-01'),
        payableAmount: new Prisma.Decimal(1600),
        baseRentAmount: new Prisma.Decimal(1700),
        rentFreeAmount: new Prisma.Decimal(100),
        discountAmount: new Prisma.Decimal(0),
        status: 'OVERDUE',
        allocations: [],
        adjustments: [],
        contract,
      },
      {
        billNo: 'EARLIER',
        periodStart: new Date('2026-08-01'),
        payableAmount: new Prisma.Decimal(1000),
        baseRentAmount: new Prisma.Decimal(1100),
        rentFreeAmount: new Prisma.Decimal(100),
        discountAmount: new Prisma.Decimal(0),
        status: 'OVERDUE',
        allocations: [allocation(0)],
        adjustments: [],
        contract,
      },
      {
        billNo: 'PAID',
        periodStart: new Date('2026-10-01'),
        payableAmount: new Prisma.Decimal(1600),
        baseRentAmount: new Prisma.Decimal(1600),
        rentFreeAmount: new Prisma.Decimal(0),
        discountAmount: new Prisma.Decimal(0),
        status: 'PAID',
        allocations: [allocation(1)],
        adjustments: [],
        contract,
      },
      {
        billNo: 'PARTIAL',
        periodStart: new Date('2026-09-01'),
        payableAmount: new Prisma.Decimal(1600),
        baseRentAmount: new Prisma.Decimal(1600),
        rentFreeAmount: new Prisma.Decimal(0),
        discountAmount: new Prisma.Decimal(0),
        status: 'PARTIAL',
        allocations: [allocation(2)],
        adjustments: [],
        contract,
      },
    ];
    const findMany = jest.fn().mockResolvedValue(rows);
    const refundFindMany = jest.fn().mockResolvedValue([]);
    const service = new FinanceService({
      db: {
        rentBill: { findMany },
        payment: { findMany: jest.fn().mockResolvedValue(payments) },
        paymentRefund: { findMany: refundFindMany },
        depositRefund: { findMany: jest.fn().mockResolvedValue([]) },
        depositTransaction: { findMany: jest.fn().mockResolvedValue([]) },
        contractVoidReversal: { findMany: jest.fn().mockResolvedValue([]) },
      },
    } as never);
    return { service, settlement, rows, payments, findMany, refundFindMany };
  }

  it('excludes checkout-day receivable and concessions while preserving unrefunded paid and partial cash', async () => {
    const { service, findMany } = checkoutFixture();
    const result = await service.rentCollection();
    expect(result.total).toEqual({
      originalReceivable: new Prisma.Decimal(1100),
      concessionAmount: new Prisma.Decimal(100),
      netReceivable: new Prisma.Decimal(1000),
      validReceived: new Prisma.Decimal(2400),
      outstanding: new Prisma.Decimal(800),
    });
    expect(result.rows[0]).toMatchObject({
      status: 'PENDING_CHECKOUT_REVIEW',
      originalReceivable: new Prisma.Decimal(0),
      outstanding: new Prisma.Decimal(0),
    });
    expect(result.rows[2].validReceived).toEqual(new Prisma.Decimal(1600));
    const cash = await service.cashFlows();
    expect(cash.inflow.toFixed(2)).toBe('2400.00');
    expect(cash.netCashFlow.toFixed(2)).toBe('2400.00');
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          contract: expect.objectContaining({
            include: expect.objectContaining({
              checkoutSettlements: {
                where: {
                  status: { in: ['DRAFT', 'PENDING', 'APPROVED', 'REJECTED'] },
                },
                select: { status: true, actualCheckoutDate: true },
                orderBy: { id: 'desc' },
              },
            }),
          }),
        }),
      }),
    );
  });

  it('reduces unperformed cash only after an actual allocation reversal and refund', async () => {
    const { service, rows, payments, refundFindMany } = checkoutFixture();
    expect(
      (await service.rentCollection()).total.netReceivable.toFixed(2),
    ).toBe('1000.00');
    rows[2].allocations[0].reversedAmount = new Prisma.Decimal(400);
    payments[1].status = 'PARTIALLY_REFUNDED';
    refundFindMany.mockResolvedValue([
      {
        id: 9,
        refundDate: new Date('2026-09-03'),
        refundAmount: new Prisma.Decimal(400),
        refundNo: 'TK-9',
        payment: { paymentCategory: 'RENT' },
      },
    ]);
    expect(
      (await service.rentCollection()).total.validReceived.toFixed(2),
    ).toBe('2000.00');
    expect((await service.cashFlows()).netCashFlow.toFixed(2)).toBe('2000.00');
  });

  it('restores original receivable and arrears after the same checkout is cancelled', async () => {
    const { service, settlement } = checkoutFixture();
    expect((await service.rentCollection()).total.outstanding.toFixed(2)).toBe(
      '800.00',
    );
    settlement.status = 'CANCELLED';
    const result = await service.rentCollection();
    expect(result.total.originalReceivable.toFixed(2)).toBe('6000.00');
    expect(result.total.netReceivable.toFixed(2)).toBe('5800.00');
    expect(result.total.outstanding.toFixed(2)).toBe('3400.00');
    expect(result.total.validReceived.toFixed(2)).toBe('2400.00');
    expect(result.rows[0].status).toBe('OVERDUE');
  });

  it('queries only rental bills when calculating rent collection', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const service = new FinanceService({
      db: { rentBill: { findMany } },
    } as never);

    await service.rentCollection('2026-08-01', '2026-08-31');

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          billCategory: 'RENT',
          status: { not: 'VOIDED' },
          contract: { status: { not: 'VOIDED' } },
        }),
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      }),
    );
  });

  it('includes only active approved discount and waiver adjustments in rent concessions', async () => {
    const findMany = jest.fn().mockResolvedValue([
      {
        billNo: 'BILL-001',
        periodStart: new Date('2026-08-01'),
        baseRentAmount: new Prisma.Decimal('1000.00'),
        rentFreeAmount: new Prisma.Decimal('100.00'),
        discountAmount: new Prisma.Decimal('50.00'),
        payableAmount: new Prisma.Decimal('800.00'),
        status: 'PENDING',
        contract: {
          contractNo: 'HT-001',
          room: { fullHouseNo: '1-101' },
          members: [{ tenant: { name: '测试租户' } }],
        },
        allocations: [],
        adjustments: [
          { amount: new Prisma.Decimal('30.00') },
          { amount: new Prisma.Decimal('20.00') },
        ],
      },
    ]);
    const service = new FinanceService({
      db: { rentBill: { findMany } },
    } as never);

    const report = await service.rentCollection();

    expect(findMany.mock.calls[0][0].include.adjustments).toEqual({
      where: {
        adjustmentType: { in: ['DISCOUNT', 'WAIVER'] },
        direction: 'DECREASE',
        approvalStatus: 'APPROVED',
        reversedByAdjustmentId: null,
      },
      select: { amount: true },
    });
    expect(report.rows[0].concessionAmount).toEqual(
      new Prisma.Decimal('200.00'),
    );
    expect(report.rows[0].netReceivable).toEqual(new Prisma.Decimal('800.00'));
    expect(report.total.concessionAmount).toEqual(new Prisma.Decimal('200.00'));
  });

  it('nets approved rent, prepayment, and deposit refunds from received totals', async () => {
    const paymentFindMany = jest.fn().mockResolvedValue([
      {
        id: 1,
        paymentDate: new Date('2026-08-05'),
        updatedAt: new Date('2026-08-05T08:00:00.000Z'),
        paymentCategory: 'RENT',
        amount: new Prisma.Decimal('1000.00'),
        receiptNo: 'SK-RENT-1',
        status: 'CONFIRMED',
      },
      {
        id: 2,
        paymentDate: new Date('2026-08-06'),
        updatedAt: new Date('2026-08-06T08:00:00.000Z'),
        paymentCategory: 'DEPOSIT',
        amount: new Prisma.Decimal('3000.00'),
        receiptNo: 'SK-DEPOSIT-2',
        status: 'PARTIALLY_REFUNDED',
      },
      {
        id: 5,
        paymentDate: new Date('2026-08-06'),
        updatedAt: new Date('2026-08-06T09:00:00.000Z'),
        paymentCategory: 'PREPAYMENT',
        amount: new Prisma.Decimal('600.00'),
        receiptNo: 'SK-PREPAYMENT-5',
        status: 'CONFIRMED',
      },
      {
        id: 6,
        paymentDate: new Date('2026-08-06'),
        updatedAt: new Date('2026-08-06T10:00:00.000Z'),
        paymentCategory: 'RENT',
        amount: new Prisma.Decimal('600.00'),
        receiptNo: 'SK-FULLY-REFUNDED-6',
        status: 'FULLY_REFUNDED',
      },
      {
        id: 3,
        paymentDate: new Date('2026-08-07'),
        updatedAt: new Date('2026-08-07T08:00:00.000Z'),
        paymentCategory: 'CHECKOUT_SUPPLEMENTAL',
        amount: new Prisma.Decimal('500.00'),
        receiptNo: 'SK-CHECKOUT-3',
        status: 'CONFIRMED',
      },
      {
        id: 4,
        paymentDate: new Date('2026-08-08'),
        updatedAt: new Date('2026-08-08T08:00:00.000Z'),
        paymentCategory: 'RENT',
        amount: new Prisma.Decimal('700.00'),
        receiptNo: 'SK-VOIDED-4',
        status: 'VOIDED',
      },
    ]);
    const service = new FinanceService({
      db: {
        payment: { findMany: paymentFindMany },
        paymentRefund: {
          findMany: jest.fn().mockResolvedValue([
            {
              id: 21,
              refundDate: new Date('2026-08-09'),
              updatedAt: new Date('2026-08-09T08:00:00.000Z'),
              refundAmount: new Prisma.Decimal('200.00'),
              refundNo: 'TK-ORDINARY-21',
            },
          ]),
        },
        depositRefund: {
          findMany: jest.fn().mockResolvedValue([
            {
              id: 22,
              refundDate: new Date('2026-08-10'),
              updatedAt: new Date('2026-08-10T08:00:00.000Z'),
              refundAmount: new Prisma.Decimal('400.00'),
              depositRefundAmount: new Prisma.Decimal('100.00'),
              prepaymentRefundAmount: new Prisma.Decimal('100.00'),
              rentRefundAmount: new Prisma.Decimal('200.00'),
              refundNo: 'TZ-REFUND-22',
            },
          ]),
        },
        depositTransaction: { findMany: jest.fn().mockResolvedValue([]) },
        contractVoidReversal: { findMany: jest.fn().mockResolvedValue([]) },
      },
    } as never);

    const report = await service.cashFlows('2026-08-01', '2026-08-31');

    expect(report.rentAndDepositReceivedTotal).toEqual(
      new Prisma.Decimal('4600.00'),
    );
    expect(report.outflow).toEqual(new Prisma.Decimal('600.00'));
    expect(paymentFindMany).toHaveBeenCalledWith({
      where: {
        OR: [
          {
            status: {
              in: ['CONFIRMED', 'PARTIALLY_REFUNDED', 'FULLY_REFUNDED'],
            },
          },
          { id: { in: [] } },
        ],
        paymentDate: {
          gte: new Date('2026-07-31T16:00:00.000Z'),
          lt: new Date('2026-08-31T16:00:00.000Z'),
        },
      },
    });
  });
  it('labels checkout supplemental receipts without counting them as rental receipts', async () => {
    const service = new FinanceService({
      db: {
        payment: {
          findMany: jest.fn().mockResolvedValue([
            {
              paymentDate: new Date('2026-08-22'),
              paymentCategory: 'CHECKOUT_SUPPLEMENTAL',
              amount: '100.00',
              receiptNo: 'SK-1',
            },
          ]),
        },
        paymentRefund: { findMany: jest.fn().mockResolvedValue([]) },
        depositRefund: { findMany: jest.fn().mockResolvedValue([]) },
        depositTransaction: { findMany: jest.fn().mockResolvedValue([]) },
        contractVoidReversal: { findMany: jest.fn().mockResolvedValue([]) },
      },
    } as never);

    await expect(service.cashFlows()).resolves.toMatchObject({
      flows: [
        expect.objectContaining({
          type: '退租补收',
          countsAsRentReceipt: false,
        }),
      ],
    });
  });

  it('counts only confirmed checkout deposit deductions as operating income', async () => {
    const service = new FinanceService({
      db: {
        payment: { findMany: jest.fn().mockResolvedValue([]) },
        paymentRefund: { findMany: jest.fn().mockResolvedValue([]) },
        depositRefund: { findMany: jest.fn().mockResolvedValue([]) },
        depositTransaction: {
          findMany: jest.fn().mockResolvedValue([
            {
              id: 71,
              occurredAt: new Date('2026-09-03T08:00:00.000Z'),
              transactionType: 'OFFSET_SETTLEMENT',
              amount: new Prisma.Decimal('200.00'),
              transactionNo: 'YJ-JY-71',
              checkoutSettlement: { status: 'COMPLETED' },
            },
            {
              id: 73,
              occurredAt: new Date('2026-09-03T08:00:00.000Z'),
              transactionType: 'OFFSET_SETTLEMENT',
              amount: new Prisma.Decimal('100.00'),
              transactionNo: 'YJ-CANCELLED-73',
              checkoutSettlement: { status: 'CANCELLED' },
            },
            {
              id: 72,
              occurredAt: new Date('2026-09-03T08:00:00.000Z'),
              transactionType: 'OFFSET_ARREARS',
              amount: new Prisma.Decimal('300.00'),
              transactionNo: 'YJ-QZ-72',
            },
          ]),
        },
        contractVoidReversal: { findMany: jest.fn().mockResolvedValue([]) },
      },
    } as never);

    const report = await service.cashFlows();

    expect(report.operatingIncome).toEqual(new Prisma.Decimal('200.00'));
    expect(report.rentAndDepositReceivedTotal).toEqual(
      new Prisma.Decimal('0.00'),
    );
    expect(report.flows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          reference: 'YJ-JY-71',
          type: '退租扣款',
        }),
        expect.objectContaining({
          reference: 'YJ-QZ-72',
          type: '押金抵扣欠租',
        }),
      ]),
    );
  });

  it('orders every cash-flow source by activity time and source id without exposing sortAt', async () => {
    const tieTime = new Date('2026-09-01T08:00:00.000Z');
    const contractVoidReversalFindMany = jest.fn().mockImplementation((args) =>
      Promise.resolve(
        args.select
          ? []
          : [
              {
                id: 60,
                category: 'PAYMENT',
                amount: new Prisma.Decimal('-50.00'),
                balanceBefore: new Prisma.Decimal('50.00'),
                balanceAfter: new Prisma.Decimal('0.00'),
                originalEntityType: 'Payment',
                originalEntityId: 6,
                generatedEntityType: null,
                generatedEntityId: null,
                originalOccurredAt: new Date('2026-08-01'),
                correctionOccurredAt: tieTime,
                request: {
                  requestNo: 'HTZF-TIE-6',
                  contract: { contractNo: 'HT-TIE' },
                },
              },
            ],
      ),
    );
    const service = new FinanceService({
      db: {
        payment: {
          findMany: jest.fn().mockResolvedValue([
            {
              id: 1,
              paymentDate: new Date('2026-08-30'),
              updatedAt: new Date('2026-08-30T08:00:00.000Z'),
              paymentCategory: 'RENT',
              amount: new Prisma.Decimal('100.00'),
              receiptNo: 'SK-OLD-EDIT',
              status: 'CONFIRMED',
            },
            {
              id: 2,
              paymentDate: new Date('2026-08-01'),
              updatedAt: tieTime,
              paymentCategory: 'RENT',
              amount: new Prisma.Decimal('200.00'),
              receiptNo: 'SK-TIE-2',
              status: 'CONFIRMED',
            },
          ]),
        },
        paymentRefund: {
          findMany: jest.fn().mockResolvedValue([
            {
              id: 9,
              refundDate: new Date('2026-08-02'),
              updatedAt: tieTime,
              refundAmount: new Prisma.Decimal('90.00'),
              refundNo: 'TK-TIE-9',
            },
          ]),
        },
        depositRefund: {
          findMany: jest.fn().mockResolvedValue([
            {
              id: 8,
              refundDate: new Date('2026-08-03'),
              updatedAt: tieTime,
              refundAmount: new Prisma.Decimal('80.00'),
              depositRefundAmount: new Prisma.Decimal('80.00'),
              prepaymentRefundAmount: new Prisma.Decimal('0.00'),
              rentRefundAmount: new Prisma.Decimal('0.00'),
              refundNo: 'YJTK-TIE-8',
            },
          ]),
        },
        depositTransaction: {
          findMany: jest.fn().mockResolvedValue([
            {
              id: 7,
              occurredAt: new Date('2026-09-02T08:00:00.000Z'),
              transactionType: 'OFFSET_ARREARS',
              amount: new Prisma.Decimal('70.00'),
              transactionNo: 'YJ-LATEST-7',
            },
          ]),
        },
        contractVoidReversal: { findMany: contractVoidReversalFindMany },
      },
    } as never);

    const report = await service.cashFlows();

    expect(report.flows.map((item) => item.reference)).toEqual([
      'YJ-LATEST-7',
      'TK-TIE-9',
      'YJTK-TIE-8',
      'HTZF-TIE-6',
      'SK-TIE-2',
      'SK-OLD-EDIT',
    ]);
    expect(report.flows.every((item) => !('sortAt' in item))).toBe(true);
  });
  it('sums only the latest deposit balance of each contract', async () => {
    const depositFindMany = jest.fn().mockResolvedValue([
      { contractId: 1, balanceAfter: new Prisma.Decimal('7000.00') },
      { contractId: 2, balanceAfter: new Prisma.Decimal('3000.00') },
      { contractId: 3, balanceAfter: new Prisma.Decimal('0.00') },
    ]);
    const prepaymentFindMany = jest.fn().mockResolvedValue([
      { contractId: 1, balanceAfter: new Prisma.Decimal('500.00') },
      { contractId: 2, balanceAfter: new Prisma.Decimal('200.00') },
    ]);
    const service = new FinanceService({
      db: {
        depositTransaction: { findMany: depositFindMany },
        prepaymentTransaction: { findMany: prepaymentFindMany },
      },
    } as never);

    await expect(service.overview()).resolves.toEqual({
      depositBalanceTotal: new Prisma.Decimal('10000.00'),
      prepaymentBalanceTotal: new Prisma.Decimal('700.00'),
    });
    expect(depositFindMany).toHaveBeenCalledWith({
      where: { contract: { status: { not: 'VOIDED' } } },
      distinct: ['contractId'],
      orderBy: [{ contractId: 'asc' }, { id: 'desc' }],
      select: { contractId: true, balanceAfter: true },
    });
    expect(prepaymentFindMany).toHaveBeenCalledWith({
      where: { contract: { status: { not: 'VOIDED' } } },
      distinct: ['contractId'],
      orderBy: [{ contractId: 'asc' }, { id: 'desc' }],
      select: { contractId: true, balanceAfter: true },
    });
  });

  it('returns a zero deposit balance when no ledger exists', async () => {
    const service = new FinanceService({
      db: {
        depositTransaction: { findMany: jest.fn().mockResolvedValue([]) },
        prepaymentTransaction: { findMany: jest.fn().mockResolvedValue([]) },
      },
    } as never);

    await expect(service.overview()).resolves.toEqual({
      depositBalanceTotal: new Prisma.Decimal('0.00'),
      prepaymentBalanceTotal: new Prisma.Decimal('0.00'),
    });
  });

  it('keeps original voided receipts and globally merges monetary corrections by correction date', async () => {
    const correctionOccurredAt = new Date('2026-08-26T10:00:00.000Z');
    const originalOccurredAt = new Date('2026-08-02T09:00:00.000Z');
    const contractVoidReversalFindMany = jest.fn().mockResolvedValue([
      {
        id: 91,
        category: 'PAYMENT',
        amount: new Prisma.Decimal('-120.00'),
        balanceBefore: new Prisma.Decimal('120.00'),
        balanceAfter: new Prisma.Decimal('0.00'),
        originalEntityType: 'Payment',
        originalEntityId: 31,
        generatedEntityType: null,
        generatedEntityId: null,
        originalOccurredAt,
        correctionOccurredAt,
        request: {
          requestNo: 'HTZF202608260001',
          contract: { contractNo: 'HT20260001' },
        },
      },
    ]);
    const paymentFindMany = jest.fn().mockResolvedValue([
      {
        id: 31,
        paymentDate: originalOccurredAt,
        paymentCategory: 'RENT',
        amount: new Prisma.Decimal('120.00'),
        receiptNo: 'SK-31',
        status: 'VOIDED',
      },
    ]);
    const service = new FinanceService({
      db: {
        payment: { findMany: paymentFindMany },
        paymentRefund: { findMany: jest.fn().mockResolvedValue([]) },
        depositRefund: { findMany: jest.fn().mockResolvedValue([]) },
        depositTransaction: { findMany: jest.fn().mockResolvedValue([]) },
        contractVoidReversal: { findMany: contractVoidReversalFindMany },
      },
    } as never);

    const report = await service.cashFlows('2026-08-01', '2026-08-31');

    expect(paymentFindMany).toHaveBeenCalledWith({
      where: {
        OR: [
          {
            status: {
              in: ['CONFIRMED', 'PARTIALLY_REFUNDED', 'FULLY_REFUNDED'],
            },
          },
          { id: { in: expect.any(Array) } },
        ],
        paymentDate: {
          gte: new Date('2026-07-31T16:00:00.000Z'),
          lt: new Date('2026-08-31T16:00:00.000Z'),
        },
      },
    });
    expect(contractVoidReversalFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          category: {
            in: [
              'RENT_BILL',
              'PAYMENT',
              'PAYMENT_ALLOCATION',
              'PREPAYMENT',
              'DEPOSIT',
              'REFUND',
              'ADJUSTMENT',
              'PRICING_REBATE',
            ],
          },
          correctionOccurredAt: {
            gte: new Date('2026-07-31T16:00:00.000Z'),
            lt: new Date('2026-08-31T16:00:00.000Z'),
          },
          balanceBefore: { not: null },
          balanceAfter: { not: null },
        }),
      }),
    );
    expect(report.total).toBe(2);
    expect(report.flows).toHaveLength(2);
    expect(report.flows[0]).toMatchObject({
      flowType: 'CONTRACT_VOID_REVERSAL',
      type: '\u5408\u540c\u7ea0\u9519\u51b2\u9500',
      amount: new Prisma.Decimal('-120.00'),
      direction: 'OUT',
      external: false,
      countsAsRentReceipt: false,
      reference: 'HTZF202608260001',
      requestNo: 'HTZF202608260001',
      contractNo: 'HT20260001',
      correctionOccurredAt,
      originalOccurredAt,
      source: { entityType: 'Payment', entityId: 31 },
      generatedSource: null,
    });
    expect(report.flows[1]).toMatchObject({
      type: '\u79df\u91d1\u6536\u6b3e',
      reference: 'SK-31',
      countsAsRentReceipt: false,
    });
  });

  it('reports one combined checkout refund outflow with all three splits', async () => {
    const refundDate = new Date('2026-08-30T00:00:00.000Z');
    const depositRefundFindMany = jest.fn().mockResolvedValue([
      {
        id: 33,
        refundNo: 'YJTK202608300033',
        refundDate,
        refundAmount: new Prisma.Decimal('10500.00'),
        depositRefundAmount: new Prisma.Decimal('7500.00'),
        prepaymentRefundAmount: new Prisma.Decimal('1000.00'),
        rentRefundAmount: new Prisma.Decimal('2000.00'),
      },
    ]);
    const service = new FinanceService({
      db: {
        payment: { findMany: jest.fn().mockResolvedValue([]) },
        paymentRefund: { findMany: jest.fn().mockResolvedValue([]) },
        depositRefund: { findMany: depositRefundFindMany },
        depositTransaction: {
          findMany: jest.fn().mockResolvedValue([
            {
              id: 401,
              transactionType: 'REFUND',
              occurredAt: refundDate,
              amount: new Prisma.Decimal('7500.00'),
              transactionNo: 'YJTK202608300033-DEPOSIT',
            },
          ]),
        },
        contractVoidReversal: { findMany: jest.fn().mockResolvedValue([]) },
      },
    } as never);

    const report = await service.cashFlows();
    const combined = report.flows.filter(
      (item) => item.flowType === 'CHECKOUT_COMBINED_REFUND',
    );

    expect(combined).toHaveLength(1);
    expect(combined[0]).toMatchObject({
      type: '退租合并退款（押金 ¥7500.00、预收款 ¥1000.00、租金 ¥2000.00）',
      amount: new Prisma.Decimal('10500.00'),
      direction: 'OUT',
      external: true,
      reference: 'YJTK202608300033',
      source: { entityType: 'DepositRefund', entityId: 33 },
    });
    expect(report.outflow.toFixed(2)).toBe('10500.00');
    expect(report.flows).toHaveLength(1);
    expect(depositRefundFindMany).toHaveBeenCalledWith({
      where: { approvalStatus: 'APPROVED' },
    });
  });
});
