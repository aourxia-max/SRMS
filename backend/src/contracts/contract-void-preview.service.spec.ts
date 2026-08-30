import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import { ContractVoidPreviewService } from './contract-void-preview.service';

const admin = {
  id: 2,
  username: 'admin',
  displayName: '管理员',
  role: UserRole.ADMIN,
};

function contractFixture() {
  return {
    id: 7,
    status: 'ACTIVE',
    roomId: 3,
    room: { roomStatus: 'RENTED' },
    members: [{ id: 10, tenantId: 20, memberRole: 'PRIMARY', isCurrent: true }],
    bills: [
      {
        id: 11,
        status: 'PAID',
        payableAmount: new Prisma.Decimal('3000.00'),
        receivedAmount: new Prisma.Decimal('3000.00'),
        outstandingAmount: new Prisma.Decimal('0.00'),
        periodStart: new Date('2026-08-01T00:00:00.000Z'),
        adjustments: [
          {
            id: 31,
            rentBillId: 11,
            adjustmentType: 'DISCOUNT',
            direction: 'DECREASE',
            amount: new Prisma.Decimal('100.00'),
            beforeAmount: new Prisma.Decimal('3100.00'),
            afterAmount: new Prisma.Decimal('3000.00'),
            approvalStatus: 'PENDING',
            submittedAt: new Date('2026-08-02T01:00:00.000Z'),
            approvedAt: null,
          },
        ],
      },
    ],
    payments: [
      {
        id: 21,
        status: 'PARTIALLY_REFUNDED',
        amount: new Prisma.Decimal('3500.00'),
        paymentDate: new Date('2026-08-03T00:00:00.000Z'),
        allocations: [
          {
            id: 22,
            paymentId: 21,
            rentBillId: 11,
            allocatedAmount: new Prisma.Decimal('3000.00'),
            reversedAmount: new Prisma.Decimal('200.00'),
            allocationType: 'AUTO_OLDEST_FIRST',
            allocatedAt: new Date('2026-08-03T02:00:00.000Z'),
          },
        ],
        refunds: [
          {
            id: 41,
            paymentId: 21,
            approvalStatus: 'APPROVED',
            refundAmount: new Prisma.Decimal('500.00'),
            refundDate: new Date('2026-08-04T00:00:00.000Z'),
          },
          {
            id: 42,
            paymentId: 21,
            approvalStatus: 'PENDING',
            refundAmount: new Prisma.Decimal('100.00'),
            refundDate: new Date('2026-08-05T00:00:00.000Z'),
          },
        ],
        prepaymentTransactions: [
          {
            id: 51,
            transactionType: 'CREDIT_RECEIPT',
            amount: new Prisma.Decimal('500.00'),
          },
          {
            id: 52,
            transactionType: 'REVERSAL',
            amount: new Prisma.Decimal('100.00'),
          },
        ],
        voidRequests: [{ id: 61, approvalStatus: 'PENDING' }],
      },
    ],
    refunds: [
      {
        id: 41,
        paymentId: 21,
        approvalStatus: 'APPROVED',
        refundAmount: new Prisma.Decimal('500.00'),
        refundDate: new Date('2026-08-04T00:00:00.000Z'),
      },
      {
        id: 42,
        paymentId: 21,
        approvalStatus: 'PENDING',
        refundAmount: new Prisma.Decimal('100.00'),
        refundDate: new Date('2026-08-05T00:00:00.000Z'),
      },
    ],
    prepaymentTransactions: [
      {
        id: 71,
        balanceAfter: new Prisma.Decimal('400.00'),
        occurredAt: new Date('2026-08-06T03:00:00.000Z'),
      },
    ],
    depositTransactions: [
      {
        id: 72,
        balanceAfter: new Prisma.Decimal('1000.00'),
        occurredAt: new Date('2026-08-06T04:00:00.000Z'),
      },
    ],
    changes: [{ id: 81, approvalStatus: 'DRAFT' }],
    concessions: [],
    pricingRebates: [
      {
        id: 91,
        sourceType: 'FIXED_RENT_MANUAL',
        rebateType: 'MANUAL',
        rentBillId: 11,
        approvalStatus: 'PENDING',
        settlementMethod: 'ACTUAL_REFUND',
        grossBilledAmount: new Prisma.Decimal('3000.00'),
        previousRebateAmount: new Prisma.Decimal('0.00'),
        referenceAmount: new Prisma.Decimal('3000.00'),
        targetNetRentAmount: new Prisma.Decimal('2900.00'),
        actualAmount: new Prisma.Decimal('100.00'),
        differenceAmount: new Prisma.Decimal('0.00'),
        periodStart: new Date('2026-08-01T00:00:00.000Z'),
        periodEnd: new Date('2026-08-31T00:00:00.000Z'),
        refundDate: null,
        submittedAt: new Date('2026-08-07T01:00:00.000Z'),
        approvedAt: null,
      },
    ],
    checkoutSettlements: [
      {
        id: 101,
        checkoutType: 'NORMAL',
        originContractStatus: 'ACTIVE',
        status: 'COMPLETED',
        rentReceivable: new Prisma.Decimal('3000.00'),
        rentReceived: new Prisma.Decimal('3000.00'),
        rentOutstanding: new Prisma.Decimal('0.00'),
        prepaymentBalance: new Prisma.Decimal('400.00'),
        depositBalance: new Prisma.Decimal('1000.00'),
        depositOffsetAmount: new Prisma.Decimal('0.00'),
        otherDeductionAmount: new Prisma.Decimal('0.00'),
        depositRefundableAmount: new Prisma.Decimal('1000.00'),
        prepaymentRefundableAmount: new Prisma.Decimal('400.00'),
        finalReceivable: new Prisma.Decimal('0.00'),
        supplementalArrearsAmount: new Prisma.Decimal('0.00'),
        supplementalInspectionAmount: new Prisma.Decimal('0.00'),
        supplementalReceivedAmount: new Prisma.Decimal('0.00'),
        supplementalOutstandingAmount: new Prisma.Decimal('0.00'),
        actualCheckoutDate: new Date('2026-08-08T00:00:00.000Z'),
        approvedAt: new Date('2026-08-08T02:00:00.000Z'),
      },
      {
        id: 102,
        checkoutType: 'EARLY',
        originContractStatus: 'ACTIVE',
        status: 'DRAFT',
        rentReceivable: new Prisma.Decimal('0.00'),
        rentReceived: new Prisma.Decimal('0.00'),
        rentOutstanding: new Prisma.Decimal('0.00'),
        prepaymentBalance: new Prisma.Decimal('0.00'),
        depositBalance: new Prisma.Decimal('0.00'),
        depositOffsetAmount: new Prisma.Decimal('0.00'),
        otherDeductionAmount: new Prisma.Decimal('0.00'),
        depositRefundableAmount: new Prisma.Decimal('0.00'),
        prepaymentRefundableAmount: new Prisma.Decimal('0.00'),
        finalReceivable: new Prisma.Decimal('0.00'),
        supplementalArrearsAmount: new Prisma.Decimal('0.00'),
        supplementalInspectionAmount: new Prisma.Decimal('0.00'),
        supplementalReceivedAmount: new Prisma.Decimal('0.00'),
        supplementalOutstandingAmount: new Prisma.Decimal('0.00'),
        actualCheckoutDate: null,
        approvedAt: null,
      },
    ],
    depositRefunds: [
      { id: 103, approvalStatus: 'PENDING' },
      {
        id: 104,
        refundNo: 'YJTK20260826000104',
        checkoutSettlementId: 101,
        refundAmount: new Prisma.Decimal('1000.00'),
        refundDate: new Date('2026-08-08T00:00:00.000Z'),
        refundMethod: 'BANK_TRANSFER',
        approvalStatus: 'APPROVED',
        approvedAt: new Date('2026-08-08T03:00:00.000Z'),
        transactions: [{ id: 73 }],
      },
    ],
    commissions: [
      {
        id: 111,
        amount: new Prisma.Decimal('600.00'),
        createdAt: new Date('2026-08-01T01:00:00.000Z'),
        deletedAt: null,
      },
    ],
  };
}

function buildDb(fixture = contractFixture(), laterIds = [8]) {
  return {
    contract: {
      findUniqueOrThrow: jest.fn().mockResolvedValue(fixture),
      findMany: jest.fn().mockResolvedValue(laterIds.map((id) => ({ id }))),
    },
  };
}

describe('ContractVoidPreviewService', () => {
  it('loads and retains every required contract relation in a stable preview snapshot', async () => {
    const db = buildDb();
    const service = new ContractVoidPreviewService({ db } as never);

    await expect(service.preview(7, admin)).resolves.toMatchObject({
      contract: { id: 7 },
      impactHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      summary: {
        effectivePayment: '3000.00',
        prepaymentBalance: '400.00',
        depositBalance: '1000.00',
      },
      pending: {
        adjustments: [31],
        refunds: [42],
        voidRequests: [61],
        changes: [81],
        rebates: [91],
        checkouts: [102],
        depositRefunds: [103],
      },
      completedCheckoutIds: [101],
      room: { hasLaterContract: true, action: 'KEEP_CURRENT_STATUS' },
      sourceSnapshot: {
        prepaymentBalanceSource: {
          id: 71,
          balanceAfter: '400.00',
          occurredAt: '2026-08-06T03:00:00.000Z',
        },
        depositBalanceSource: {
          id: 72,
          balanceAfter: '1000.00',
          occurredAt: '2026-08-06T04:00:00.000Z',
        },
        contractMembers: [
          { id: 10, tenantId: 20, memberRole: 'PRIMARY', isCurrent: true },
        ],
        paymentAllocations: [
          {
            id: 22,
            paymentId: 21,
            rentBillId: 11,
            allocatedAmount: '3000.00',
            reversedAmount: '200.00',
            allocationType: 'AUTO_OLDEST_FIRST',
            occurredAt: '2026-08-03T02:00:00.000Z',
          },
        ],
        adjustments: expect.arrayContaining([
          expect.objectContaining({
            id: 31,
            approvalStatus: 'PENDING',
            amount: '100.00',
            occurredAt: '2026-08-02T01:00:00.000Z',
          }),
        ]),
        rebates: [
          expect.objectContaining({
            id: 91,
            approvalStatus: 'PENDING',
            actualAmount: '100.00',
            periodStart: '2026-08-01T00:00:00.000Z',
          }),
        ],
        checkoutSettlements: [
          expect.objectContaining({
            id: 101,
            status: 'COMPLETED',
            depositRefundableAmount: '1000.00',
            occurredAt: '2026-08-08T00:00:00.000Z',
          }),
          expect.objectContaining({ id: 102, status: 'DRAFT' }),
        ],
        commissions: [
          {
            id: 111,
            amount: '600.00',
            occurredAt: '2026-08-01T01:00:00.000Z',
            deletedAt: null,
          },
        ],
      },
    });
    expect(db.contract.findUniqueOrThrow).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 7 },
        select: expect.objectContaining({
          members: expect.any(Object),
          room: expect.any(Object),
          bills: expect.any(Object),
          payments: expect.any(Object),
          refunds: expect.any(Object),
          prepaymentTransactions: expect.any(Object),
          depositTransactions: expect.any(Object),
          changes: expect.any(Object),
          pricingRebates: expect.any(Object),
          checkoutSettlements: expect.any(Object),
          depositRefunds: expect.any(Object),
          commissions: expect.any(Object),
        }),
      }),
    );
    expect(db.contract.findMany).toHaveBeenCalledWith({
      where: {
        roomId: 3,
        id: { not: 7 },
        status: { in: ['PENDING_START', 'ACTIVE', 'PENDING_CHECKOUT'] },
      },
      orderBy: { id: 'asc' },
      select: { id: true },
    });
  });
  it('snapshots checkout rent allocations, generated adjustments, and combined refund splits', async () => {
    const fixture = contractFixture() as any;
    fixture.payments[0].checkoutRentRefundAllocations = [
      {
        id: 501,
        checkoutSettlementItemId: 801,
        paymentAllocationId: 22,
        paymentId: 21,
        rentBillId: 11,
        reservedAmount: new Prisma.Decimal('1000.00'),
        status: 'APPLIED',
        reservedAt: new Date('2026-08-20T01:00:00.000Z'),
        releasedAt: null,
        appliedAt: new Date('2026-08-30T04:00:00.000Z'),
        depositRefundId: 104,
      },
    ];
    fixture.bills[0].adjustments.push({
      id: 32,
      rentBillId: 11,
      adjustmentType: 'CHECKOUT_RENT_REFUND',
      direction: 'DECREASE',
      amount: new Prisma.Decimal('1000.00'),
      beforeAmount: new Prisma.Decimal('3000.00'),
      afterAmount: new Prisma.Decimal('2000.00'),
      checkoutSettlementItemId: 801,
      approvalStatus: 'APPROVED',
      submittedAt: new Date('2026-08-30T04:00:00.000Z'),
      approvedAt: new Date('2026-08-30T04:00:00.000Z'),
    });
    fixture.checkoutSettlements[0].rentRefundableAmount = new Prisma.Decimal(
      '1000.00',
    );
    Object.assign(fixture.depositRefunds[1], {
      refundAmount: new Prisma.Decimal('2400.00'),
      depositRefundAmount: new Prisma.Decimal('1000.00'),
      prepaymentRefundAmount: new Prisma.Decimal('400.00'),
      rentRefundAmount: new Prisma.Decimal('1000.00'),
    });
    const service = new ContractVoidPreviewService({
      db: buildDb(fixture),
    } as never);

    await expect(
      service.loadInput(buildDb(fixture) as never, 7),
    ).resolves.toMatchObject({
      checkoutRentRefunds: expect.arrayContaining([
        expect.objectContaining({
          id: 501,
          paymentId: 21,
          amount: '1000.00',
          status: 'APPLIED',
          depositRefundId: 104,
        }),
      ]),
      sourceSnapshot: {
        checkoutRentRefundAllocations: expect.arrayContaining([
          expect.objectContaining({ id: 501, reservedAmount: '1000.00' }),
        ]),
        adjustments: expect.arrayContaining([
          expect.objectContaining({
            id: 32,
            adjustmentType: 'CHECKOUT_RENT_REFUND',
            checkoutSettlementItemId: 801,
          }),
        ]),
        checkoutSettlements: expect.arrayContaining([
          expect.objectContaining({ id: 101, rentRefundableAmount: '1000.00' }),
        ]),
        approvedDepositRefunds: expect.arrayContaining([
          expect.objectContaining({
            id: 104,
            amount: '2400.00',
            depositRefundAmount: '1000.00',
            prepaymentRefundAmount: '400.00',
            rentRefundAmount: '1000.00',
          }),
        ]),
      },
    });
  });
  it('changes the preview hash when a new pending deposit refund appears', async () => {
    const withoutFixture = contractFixture();
    const withFixture = contractFixture();
    withoutFixture.depositRefunds = [];
    withFixture.depositRefunds = [{ id: 105, approvalStatus: 'DRAFT' }];

    const without = new ContractVoidPreviewService({
      db: buildDb(withoutFixture),
    } as never);
    const withPending = new ContractVoidPreviewService({
      db: buildDb(withFixture),
    } as never);

    const [left, right] = await Promise.all([
      without.preview(7, admin),
      withPending.preview(7, admin),
    ]);

    expect(right.pending.depositRefunds).toEqual([105]);
    expect(right.impactHash).not.toBe(left.impactHash);
  });

  it('retains terminal workflow and concession sources that change the canonical snapshot', async () => {
    const fixture = contractFixture() as Record<string, unknown>;
    const payment = (fixture.payments as Array<Record<string, unknown>>)[0];
    payment.voidRequests = [
      { id: 61, approvalStatus: 'PENDING' },
      {
        id: 62,
        requestNo: 'SKZF20260826000062',
        paymentId: 21,
        approvalStatus: 'APPROVED',
        approvedAt: new Date('2026-08-05T03:00:00.000Z'),
      },
    ];
    fixture.concessions = [
      {
        id: 89,
        concessionType: 'FIXED_AMOUNT',
        applyMode: 'BILLING_PERIODS',
        startDate: new Date('2026-08-01T00:00:00.000Z'),
        endDate: new Date('2026-08-31T00:00:00.000Z'),
        fixedAmount: new Prisma.Decimal('100.00'),
        discountRate: null,
        billingPeriodCount: 1,
        reason: 'signing concession',
        status: 'ACTIVE',
      },
    ];
    fixture.depositRefunds = [
      {
        id: 104,
        refundNo: 'YJTK20260826000104',
        checkoutSettlementId: 101,
        refundAmount: new Prisma.Decimal('1000.00'),
        refundDate: new Date('2026-08-08T00:00:00.000Z'),
        refundMethod: 'BANK_TRANSFER',
        approvalStatus: 'APPROVED',
        approvedAt: new Date('2026-08-08T03:00:00.000Z'),
        transactions: [{ id: 73 }],
      },
    ];
    const service = new ContractVoidPreviewService({
      db: buildDb(fixture as never),
    } as never);

    await expect(
      service.loadInput(buildDb(fixture as never) as never, 7),
    ).resolves.toMatchObject({
      sourceSnapshot: {
        concessions: [
          expect.objectContaining({
            id: 89,
            status: 'ACTIVE',
            fixedAmount: '100.00',
          }),
        ],
        approvedPaymentVoidRequests: [
          expect.objectContaining({
            id: 62,
            requestNo: 'SKZF20260826000062',
            status: 'APPROVED',
            paymentId: 21,
            approvedAt: '2026-08-05T03:00:00.000Z',
          }),
        ],
        approvedDepositRefunds: expect.arrayContaining([
          expect.objectContaining({
            id: 104,
            refundNo: 'YJTK20260826000104',
            amount: '1000.00',
            refundDate: '2026-08-08T00:00:00.000Z',
            refundMethod: 'BANK_TRANSFER',
            checkoutSettlementId: 101,
            approvedAt: '2026-08-08T03:00:00.000Z',
            depositTransactionIds: [73],
          }),
        ]),
      },
    });
  });

  it('hashes equivalent source snapshots identically regardless of relation order', async () => {
    const leftFixture = contractFixture();
    const rightFixture = contractFixture();
    rightFixture.payments[0].allocations.reverse();
    rightFixture.refunds.reverse();
    rightFixture.checkoutSettlements.reverse();
    const left = new ContractVoidPreviewService({
      db: buildDb(leftFixture, [8, 9]),
    } as never);
    const right = new ContractVoidPreviewService({
      db: buildDb(rightFixture, [9, 8]),
    } as never);

    const [leftPreview, rightPreview] = await Promise.all([
      left.preview(7, admin),
      right.preview(7, admin),
    ]);

    expect(leftPreview.impactHash).toBe(rightPreview.impactHash);
  });

  it('changes the hash when a retained source amount changes', async () => {
    const leftFixture = contractFixture();
    const rightFixture = contractFixture();
    rightFixture.commissions[0].amount = new Prisma.Decimal('601.00');
    const left = new ContractVoidPreviewService({
      db: buildDb(leftFixture),
    } as never);
    const right = new ContractVoidPreviewService({
      db: buildDb(rightFixture),
    } as never);

    const [leftPreview, rightPreview] = await Promise.all([
      left.preview(7, admin),
      right.preview(7, admin),
    ]);

    expect(leftPreview.impactHash).not.toBe(rightPreview.impactHash);
  });

  it('retains null balance sources when the contract has no balance transaction', async () => {
    const fixture = contractFixture();
    fixture.prepaymentTransactions = [];
    fixture.depositTransactions = [];
    const service = new ContractVoidPreviewService({
      db: buildDb(fixture),
    } as never);

    await expect(
      service.loadInput(buildDb(fixture) as never, 7),
    ).resolves.toMatchObject({
      sourceSnapshot: {
        prepaymentBalanceSource: null,
        depositBalanceSource: null,
      },
    });
  });

  it.each(['TRANSFER_IN', 'TRANSFER_OUT'])(
    'rejects a historical prepayment %s even when it is not the latest balance row',
    async (transactionType) => {
      const fixture = contractFixture();
      fixture.prepaymentTransactions = [
        {
          id: 70,
          transactionType,
          balanceAfter: new Prisma.Decimal('200.00'),
          occurredAt: new Date('2026-08-05T03:00:00.000Z'),
        },
        {
          id: 71,
          transactionType: 'REVERSAL',
          balanceAfter: new Prisma.Decimal('0.00'),
          occurredAt: new Date('2026-08-06T03:00:00.000Z'),
        },
      ];
      const service = new ContractVoidPreviewService({
        db: buildDb(fixture),
      } as never);

      await expect(service.preview(7, admin)).rejects.toThrow(
        '存在预收款转账记录，暂不支持自动合同纠错，请人工核对',
      );
    },
  );

  it('allows a super administrator to load the same snapshot through a transaction client', async () => {
    const db = buildDb();
    const service = new ContractVoidPreviewService({ db } as never);

    await expect(service.loadInput(db as never, 7)).resolves.toMatchObject({
      contract: { id: 7 },
      sourceSnapshot: { commissions: [{ id: 111 }] },
    });
    await expect(
      service.preview(7, { ...admin, role: UserRole.SUPER_ADMIN }),
    ).resolves.toMatchObject({ contract: { id: 7 } });
  });

  it('rejects visitors with the exact visibility message', async () => {
    const service = new ContractVoidPreviewService({ db: buildDb() } as never);

    await expect(
      service.preview(7, { ...admin, role: UserRole.VISITOR }),
    ).rejects.toEqual(new ForbiddenException('当前角色不能查看合同作废影响'));
  });

  it('rejects an already voided contract with the exact correction message', async () => {
    const fixture = contractFixture();
    fixture.status = 'VOIDED';
    const service = new ContractVoidPreviewService({
      db: buildDb(fixture),
    } as never);

    await expect(service.preview(7, admin)).rejects.toEqual(
      new BadRequestException('合同已作废，不能再次发起纠错'),
    );
  });
});
