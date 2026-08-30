import {
  BillAdjustmentType,
  PaymentMethod,
  Prisma,
  UserRole,
} from '@prisma/client';
import { PaymentsService } from './payments.service';

function expectContractMutationOrder(
  entry: string,
  contractLock: jest.Mock,
  reload: jest.Mock,
  firstWrite: jest.Mock,
  reloadCallIndex = -1,
) {
  const sql = contractLock.mock.calls[0]?.[0] as
    { strings?: readonly string[] } | undefined;
  const statement = sql?.strings?.join('?') ?? '';
  const lockOrder = contractLock.mock.invocationCallOrder[0];
  const reloadOrder =
    reloadCallIndex === -1
      ? reload.mock.invocationCallOrder.at(-1)
      : reload.mock.invocationCallOrder[reloadCallIndex];
  const writeOrder = firstWrite.mock.invocationCallOrder[0];
  expect({
    entry,
    locksContractForUpdate:
      statement.includes('FROM contracts') && statement.includes('FOR UPDATE'),
    lockBeforeReload: lockOrder < reloadOrder!,
    reloadBeforeFirstWrite: reloadOrder! < writeOrder,
  }).toEqual({
    entry,
    locksContractForUpdate: true,
    lockBeforeReload: true,
    reloadBeforeFirstWrite: true,
  });
}

describe('PaymentsService.record', () => {
  const user = {
    id: 3,
    username: 'cashier',
    displayName: '收款员',
    role: UserRole.ADMIN,
  };

  function fixture() {
    const bills = [
      {
        id: 11,
        contractId: 7,
        periodSeq: 1,
        dueDate: new Date('2026-08-01'),
        periodEnd: new Date('2026-08-31'),
        payableAmount: '300.00',
        receivedAmount: '0.00',
        outstandingAmount: '300.00',
        status: 'PENDING',
      },
      {
        id: 12,
        contractId: 7,
        periodSeq: 2,
        dueDate: new Date('2026-09-01'),
        periodEnd: new Date('2026-09-30'),
        payableAmount: '300.00',
        receivedAmount: '0.00',
        outstandingAmount: '300.00',
        status: 'PENDING',
      },
    ];
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 7 }]),
      contract: {
        findUniqueOrThrow: jest
          .fn()
          .mockResolvedValueOnce({
            id: 7,
            status: 'ACTIVE',
            startDate: new Date('2026-08-01'),
            pricingTiers: [],
          })
          .mockResolvedValueOnce({
            id: 7,
            startDate: new Date('2026-08-01'),
            pricingTiers: [],
          }),
        update: jest.fn().mockResolvedValue({}),
      },
      rentBill: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce(bills)
          .mockResolvedValueOnce(bills),
        update: jest.fn().mockResolvedValue({}),
      },
      systemSetting: { findUnique: jest.fn().mockResolvedValue(null) },
      payment: {
        create: jest.fn().mockResolvedValue({
          id: 81,
          receiptNo: 'SK-TEST-81',
          contractId: 7,
          amount: '570.00',
        }),
      },
      paymentAllocation: {
        createMany: jest.fn().mockResolvedValue({ count: 2 }),
      },
      prepaymentTransaction: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({}),
      },
      billAdjustment: {
        create: jest.fn().mockResolvedValue({ id: 501 }),
      },
      fileAsset: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 31,
            category: 'PAYMENT_PROOF',
            uploadedBy: 3,
            lockedAt: null,
          },
        ]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      paymentFile: { createMany: jest.fn().mockResolvedValue({ count: 1 }) },
      securityAuditLog: { create: jest.fn().mockResolvedValue({}) },
      operationLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      db: {
        $transaction: jest.fn(
          (callback: (value: typeof tx) => Promise<unknown>) => callback(tx),
        ),
      },
    };
    return { tx, service: new PaymentsService(prisma as never) };
  }

  it('records payment, pending discount and proof in one transaction result', async () => {
    const { tx, service } = fixture();

    const result = await service.record(
      {
        contractId: 7,
        paymentDate: '2026-08-04',
        amount: '570.00',
        method: PaymentMethod.BANK_TRANSFER,
        selectedBillIds: [11, 12],
        proofFileIds: [31],
        adjustments: [
          {
            rentBillId: 12,
            adjustmentType: BillAdjustmentType.DISCOUNT,
            amount: '30.00',
            reason: '一次性优惠',
          },
        ],
      },
      user,
    );

    expect(result).toEqual({
      id: 81,
      receiptNo: 'SK-TEST-81',
      receiptType: 'PROVISIONAL',
      adjustmentIds: [501],
    });
    expect(tx.paymentAllocation.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          rentBillId: 11,
          allocatedAmount: expect.anything(),
          allocationOrder: 1,
          allocationType: 'AUTO_OLDEST_FIRST',
        }),
        expect.objectContaining({
          rentBillId: 12,
          allocationOrder: 2,
          allocationType: 'AUTO_OLDEST_FIRST',
        }),
      ],
    });
    expect(tx.billAdjustment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        rentBillId: 12,
        direction: 'DECREASE',
        approvalStatus: 'PENDING',
        sourcePaymentId: 81,
      }),
    });
    expect(tx.paymentFile.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ paymentId: 81, fileAssetId: 31 })],
    });
    expect(tx.rentBill.findMany.mock.calls[0][0].where).toEqual(
      expect.objectContaining({
        NOT: {
          checkoutSettlementItems: {
            some: {
              itemType: 'RENT_ARREARS',
              settlement: {
                supplementalRequired: true,
                status: { in: ['APPROVED', 'COMPLETED'] },
              },
            },
          },
        },
      }),
    );
    expectContractMutationOrder(
      'payment.record',
      tx.$queryRaw,
      tx.contract.findUniqueOrThrow,
      tx.payment.create,
      0,
    );
  });

  it('audits a super administrator manual allocation with its reason', async () => {
    const { tx, service } = fixture();
    const superAdmin = { ...user, id: 1, role: UserRole.SUPER_ADMIN };
    tx.fileAsset.findMany.mockResolvedValue([]);

    await service.record(
      {
        contractId: 7,
        paymentDate: '2026-08-04',
        amount: '100.00',
        method: PaymentMethod.CASH,
        selectedBillIds: [12],
        manualAllocationReason: '线下凭证指定冲抵第二期',
      },
      superAdmin,
    );

    expect(tx.securityAuditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        eventType: 'PAYMENT_ALLOCATION_OVERRIDDEN',
        operatorId: 1,
        reason: '线下凭证指定冲抵第二期',
        eventData: expect.objectContaining({
          automaticBillIds: [11],
          selectedBillIds: [12],
        }),
      }),
    });
  });

  it('rejects a proof that is not an unlocked payment proof of the operator', async () => {
    const { tx, service } = fixture();
    tx.fileAsset.findMany.mockResolvedValue([]);

    await expect(
      service.record(
        {
          contractId: 7,
          paymentDate: '2026-08-04',
          amount: '100.00',
          method: PaymentMethod.CASH,
          proofFileIds: [31],
        },
        user,
      ),
    ).rejects.toThrow('收款凭证不存在、已被使用或不属于当前操作人');
    expect(tx.payment.create).not.toHaveBeenCalled();
  });

  it('records checkout supplemental payment against original arrears before inspection charge', async () => {
    const { tx, service } = fixture();
    const arrearsBill = {
      id: 11,
      contractId: 7,
      periodSeq: 1,
      dueDate: new Date('2026-08-01'),
      periodEnd: new Date('2026-08-31'),
      payableAmount: '100.00',
      receivedAmount: '50.00',
      outstandingAmount: '50.00',
      status: 'PARTIAL',
      billCategory: 'RENT',
    };
    const inspectionBill = {
      id: 19,
      contractId: 7,
      periodSeq: 3,
      dueDate: new Date('2026-08-31'),
      periodEnd: new Date('2026-08-31'),
      payableAmount: '100.00',
      receivedAmount: '0.00',
      outstandingAmount: '100.00',
      status: 'PENDING',
      billCategory: 'CHECKOUT_SUPPLEMENTAL',
      checkoutSettlementId: 8,
    };
    tx.checkoutSettlement = {
      findUniqueOrThrow: jest.fn().mockResolvedValue({
        id: 8,
        contractId: 7,
        status: 'APPROVED',
        supplementalRequired: true,
        supplementalOutstandingAmount: '150.00',
        supplementalReceivedAmount: '0.00',
        contract: { status: 'PENDING_CHECKOUT' },
        items: [{ itemType: 'RENT_ARREARS', rentBillId: 11 }],
        supplementalBill: { id: 19 },
      }),
      update: jest.fn(),
    };
    tx.rentBill.findMany
      .mockReset()
      .mockResolvedValueOnce([arrearsBill, inspectionBill])
      .mockResolvedValueOnce([arrearsBill, inspectionBill]);
    tx.payment.create.mockResolvedValue({
      id: 82,
      receiptNo: 'SK-TEST-82',
      contractId: 7,
      amount: '120.00',
    });

    await service.recordCheckoutSupplemental(
      {
        checkoutSettlementId: 8,
        paymentDate: '2026-08-04',
        amount: '120.00',
        method: PaymentMethod.CASH,
        proofFileIds: [31],
      },
      user,
    );

    expect(tx.payment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          paymentCategory: 'CHECKOUT_SUPPLEMENTAL',
        }),
      }),
    );
    expect(tx.paymentAllocation.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          rentBillId: 11,
          allocatedAmount: expect.anything(),
          allocationOrder: 1,
        }),
        expect.objectContaining({
          rentBillId: 19,
          allocatedAmount: expect.anything(),
          allocationOrder: 2,
        }),
      ],
    });
    expect(tx.paymentFile.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ paymentId: 82, fileAssetId: 31 })],
    });
    expect(tx.fileAsset.updateMany).toHaveBeenCalledWith({
      where: { id: { in: [31] }, lockedAt: null },
      data: { lockedAt: expect.any(Date) },
    });
    expect(tx.checkoutSettlement.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          supplementalReceivedAmount: expect.anything(),
          supplementalOutstandingAmount: expect.anything(),
        }),
      }),
    );
    expectContractMutationOrder(
      'payment.recordCheckoutSupplemental',
      tx.$queryRaw,
      tx.checkoutSettlement.findUniqueOrThrow,
      tx.payment.create,
    );
  });
  it('rejects a checkout proof claimed concurrently before binding it to the payment', async () => {
    const { tx, service } = fixture();
    const settlement = {
      id: 8,
      contractId: 7,
      status: 'APPROVED',
      supplementalRequired: true,
      supplementalOutstandingAmount: '100.00',
      supplementalReceivedAmount: '0.00',
      contract: { status: 'PENDING_CHECKOUT' },
      items: [{ itemType: 'RENT_ARREARS', rentBillId: 11 }],
      supplementalBill: null,
    };
    tx.checkoutSettlement = {
      findUniqueOrThrow: jest.fn().mockResolvedValue(settlement),
      update: jest.fn(),
    };
    tx.rentBill.findMany.mockReset().mockResolvedValue([
      {
        id: 11,
        contractId: 7,
        periodSeq: 1,
        dueDate: new Date('2026-08-01'),
        periodEnd: new Date('2026-08-31'),
        payableAmount: '100.00',
        receivedAmount: '0.00',
        outstandingAmount: '100.00',
        status: 'PENDING',
        billCategory: 'RENT',
      },
    ]);
    tx.payment.create.mockResolvedValue({
      id: 82,
      receiptNo: 'SK-TEST-82',
      contractId: 7,
      amount: '100.00',
    });
    tx.fileAsset.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      service.recordCheckoutSupplemental(
        {
          checkoutSettlementId: 8,
          paymentDate: '2026-08-22',
          amount: '100.00',
          method: PaymentMethod.BANK_TRANSFER,
          proofFileIds: [31],
        },
        user,
      ),
    ).rejects.toThrow('收款凭证已被其他收款占用，请重新选择');
    expect(tx.paymentFile.createMany).not.toHaveBeenCalled();
  });
  it('re-reads the locked settlement before accumulating a concurrent supplemental payment', async () => {
    const { tx, service } = fixture();
    const baseSettlement = {
      id: 8,
      contractId: 7,
      status: 'APPROVED',
      supplementalRequired: true,
      supplementalOutstandingAmount: '100.00',
      supplementalReceivedAmount: '0.00',
      contract: { status: 'PENDING_CHECKOUT' },
      items: [{ itemType: 'RENT_ARREARS', rentBillId: 11 }],
      supplementalBill: null,
    };
    tx.checkoutSettlement = {
      findUniqueOrThrow: jest
        .fn()
        .mockResolvedValueOnce(baseSettlement)
        .mockResolvedValueOnce({
          ...baseSettlement,
          supplementalOutstandingAmount: '50.00',
          supplementalReceivedAmount: '50.00',
        }),
      update: jest.fn(),
    };
    const arrearsBill = {
      id: 11,
      contractId: 7,
      periodSeq: 1,
      dueDate: new Date('2026-08-01'),
      periodEnd: new Date('2026-08-31'),
      payableAmount: '100.00',
      receivedAmount: '50.00',
      outstandingAmount: '50.00',
      status: 'PARTIAL',
      billCategory: 'RENT',
      checkoutSettlementId: null,
    };
    tx.rentBill.findMany
      .mockReset()
      .mockResolvedValueOnce([arrearsBill])
      .mockResolvedValueOnce([arrearsBill]);

    await service.recordCheckoutSupplemental(
      {
        checkoutSettlementId: 8,
        paymentDate: '2026-08-04',
        amount: '50.00',
        method: PaymentMethod.CASH,
      },
      user,
    );

    const data = tx.checkoutSettlement.update.mock.calls[0][0].data;
    expect(data.supplementalReceivedAmount.toFixed(2)).toBe('100.00');
    expect(data.supplementalOutstandingAmount.toFixed(2)).toBe('0.00');
  });

  it('rejects rent and checkout-supplemental collection for a voided contract', async () => {
    const regular = fixture();
    regular.tx.contract.findUniqueOrThrow.mockReset().mockResolvedValue({
      id: 7,
      status: 'VOIDED',
      startDate: new Date('2026-08-01'),
    });

    await expect(
      regular.service.record(
        {
          contractId: 7,
          paymentDate: '2026-08-04',
          amount: '100.00',
          method: PaymentMethod.CASH,
        },
        user,
      ),
    ).rejects.toThrow('已作废合同不能登记收款');
    expect(regular.tx.payment.create).not.toHaveBeenCalled();

    const supplemental = fixture();
    supplemental.tx.checkoutSettlement = {
      findUniqueOrThrow: jest.fn().mockResolvedValue({
        id: 8,
        contractId: 7,
        status: 'APPROVED',
        supplementalRequired: true,
        supplementalOutstandingAmount: '100.00',
        supplementalReceivedAmount: '0.00',
        contract: { status: 'VOIDED' },
        items: [{ itemType: 'RENT_ARREARS', rentBillId: 11 }],
        supplementalBill: null,
      }),
      update: jest.fn(),
    };

    await expect(
      supplemental.service.recordCheckoutSupplemental(
        {
          checkoutSettlementId: 8,
          paymentDate: '2026-08-04',
          amount: '100.00',
          method: PaymentMethod.CASH,
        },
        user,
      ),
    ).rejects.toThrow('已作废合同不能登记退租补收款');
    expect(supplemental.tx.payment.create).not.toHaveBeenCalled();
  });

  it('rejects visitor payment registration in the service layer', async () => {
    const { service } = fixture();

    await expect(
      service.record(
        {
          contractId: 7,
          paymentDate: '2026-08-04',
          amount: '100.00',
          method: PaymentMethod.CASH,
        },
        { ...user, role: UserRole.VISITOR },
      ),
    ).rejects.toThrow('当前角色不能登记收款');
  });
});

describe('PaymentsService payment views', () => {
  const admin = {
    id: 3,
    username: 'cashier',
    displayName: '收款员',
    role: UserRole.ADMIN,
  };

  const payment = {
    id: 81,
    receiptNo: 'SK-TEST-81',
    contractId: 7,
    paymentCategory: 'RENT',
    paymentDate: new Date('2026-08-04'),
    amount: '570.00',
    method: 'BANK_TRANSFER',
    externalReference: 'BANK-001',
    operatorId: 3,
    status: 'CONFIRMED',
    voidReason: null,
    voidedBy: null,
    voidedAt: null,
    editReason: null,
    remark: '八月租金',
    contract: {
      id: 7,
      contractNo: 'HT-000007-20260801-1栋201',
      room: { id: 21, fullHouseNo: '1栋201' },
      members: [
        {
          memberRole: 'PRIMARY',
          isCurrent: true,
          tenant: { id: 9, name: '张三', phone: '13800008000' },
        },
      ],
    },
    allocations: [
      {
        id: 101,
        allocationOrder: 1,
        allocationType: 'AUTO_OLDEST_FIRST',
        allocatedAmount: '570.00',
        reversedAmount: '0.00',
        rentBill: {
          id: 11,
          billCategory: 'RENT',
          billNo: 'ZD-001',
          periodSeq: 1,
          periodStart: new Date('2026-08-01'),
          periodEnd: new Date('2026-08-31'),
          dueDate: new Date('2026-08-01'),
          contractPricingTierId: null,
          unitMonthlyRent: '600.00',
          baseRentAmount: '600.00',
          rentFreeAmount: '0.00',
          discountAmount: '0.00',
          adjustmentAmount: '0.00',
          payableAmount: '600.00',
          receivedAmount: '570.00',
          outstandingAmount: '30.00',
          status: 'PARTIAL',
        },
      },
    ],
    adjustments: [
      {
        id: 501,
        adjustmentNo: 'TZ-501',
        rentBillId: 11,
        adjustmentType: 'DISCOUNT',
        direction: 'DECREASE',
        amount: '30.00',
        beforeAmount: '600.00',
        afterAmount: '570.00',
        reason: '一次性优惠',
        sourcePaymentId: 81,
        contractChangeId: null,
        approvalStatus: 'PENDING',
        submittedBy: 3,
        submittedAt: new Date('2026-08-04'),
        approvedBy: null,
        approvedAt: null,
        rejectedReason: null,
        reversedByAdjustmentId: null,
      },
    ],
    prepaymentTransactions: [],
    paymentFiles: [
      {
        fileAssetId: 31,
        purpose: 'PAYMENT_PROOF',
        fileAsset: {
          id: 31,
          originalName: 'receipt.webp',
          mimeType: 'image/webp',
          sizeBytes: 16n,
          uploadedAt: new Date('2026-08-04'),
        },
      },
    ],
    refunds: [],
    voidRequests: [],
  };

  it('returns a serialized detail with a provisional receipt', async () => {
    const service = new PaymentsService({
      db: {
        payment: { findUnique: jest.fn().mockResolvedValue(payment) },
        contractVoidReversal: {
          findFirst: jest.fn().mockResolvedValue(null),
        },
        user: {
          findUnique: jest.fn().mockResolvedValue({
            id: 3,
            displayName: '收款员',
          }),
        },
        operationLog: { findMany: jest.fn().mockResolvedValue([]) },
      },
    } as never);

    const result = await service.detail(81, admin);

    expect(result).toEqual(
      expect.objectContaining({
        id: 81,
        amount: '570.00',
        receiptType: 'PROVISIONAL',
        tenant: { id: 9, name: '张三', phone: '13800008000' },
        metrics: {
          receivedAmount: '570.00',
          confirmedAdjustmentAmount: '0.00',
          prepaymentAmount: '0.00',
          coveredBillCount: 1,
        },
        receipt: expect.objectContaining({
          type: 'PROVISIONAL',
          amountUppercase: '伍佰柒拾元整',
        }),
      }),
    );
    expect(result.files[0].sizeBytes).toBe('16');
  });

  it('returns applied checkout rent refunds as a separate completed detail section', async () => {
    const service = new PaymentsService({
      db: {
        payment: {
          findUnique: jest.fn().mockResolvedValue({
            ...payment,
            checkoutRentRefundAllocations: [
              {
                id: 701,
                reservedAmount: new Prisma.Decimal('1000.00'),
                status: 'APPLIED',
                appliedAt: new Date('2026-08-30T04:00:00.000Z'),
                item: {
                  checkoutSettlementId: 91,
                  settlement: { settlementNo: 'TZ202608300001' },
                },
                depositRefund: {
                  id: 33,
                  refundNo: 'YJTK202608300033',
                  refundDate: new Date('2026-08-30T00:00:00.000Z'),
                  refundMethod: 'BANK_TRANSFER',
                  approvalStatus: 'APPROVED',
                  files: [
                    {
                      fileAsset: {
                        id: 77,
                        originalName: 'checkout-refund.webp',
                        mimeType: 'image/webp',
                        sizeBytes: 32n,
                      },
                    },
                  ],
                },
              },
            ],
          }),
        },
        contractVoidReversal: {
          findFirst: jest.fn().mockResolvedValue(null),
        },
        user: { findUnique: jest.fn().mockResolvedValue(null) },
        operationLog: { findMany: jest.fn().mockResolvedValue([]) },
      },
    } as never);

    const result = await service.detail(81, admin);

    expect(result.checkoutRentRefunds).toEqual([
      {
        id: 701,
        checkoutSettlementId: 91,
        settlementNo: 'TZ202608300001',
        amount: '1000.00',
        status: 'APPLIED',
        statusText: '已完成',
        appliedAt: new Date('2026-08-30T04:00:00.000Z'),
        depositRefund: {
          id: 33,
          refundNo: 'YJTK202608300033',
          refundDate: new Date('2026-08-30T00:00:00.000Z'),
          refundMethod: 'BANK_TRANSFER',
          proofFiles: [
            {
              id: 77,
              originalName: 'checkout-refund.webp',
              mimeType: 'image/webp',
              sizeBytes: '32',
            },
          ],
        },
      },
    ]);
  });
  it('masks tenant identity for a visitor', async () => {
    const service = new PaymentsService({
      db: {
        payment: { findUnique: jest.fn().mockResolvedValue(payment) },
        contractVoidReversal: {
          findFirst: jest.fn().mockResolvedValue(null),
        },
        user: { findUnique: jest.fn().mockResolvedValue(null) },
        operationLog: { findMany: jest.fn().mockResolvedValue([]) },
      },
    } as never);

    const result = await service.detail(81, {
      ...admin,
      role: UserRole.VISITOR,
    });

    expect(result.tenant).toEqual({
      id: 9,
      name: '张*',
      phone: '138****8000',
    });
  });

  it.each(['CONFIRMED', 'FULLY_REFUNDED'])(
    'marks a contract-corrected %s payment in both detail and receipt projections',
    async (status) => {
      const findFirst = jest.fn().mockResolvedValue({ id: 901 });
      const service = new PaymentsService({
        db: {
          payment: {
            findUnique: jest.fn().mockResolvedValue({ ...payment, status }),
          },
          contractVoidReversal: { findFirst },
          user: { findUnique: jest.fn().mockResolvedValue(null) },
          operationLog: { findMany: jest.fn().mockResolvedValue([]) },
        },
      } as never);

      const result = await service.detail(81, admin);
      const receipt = await service.receipt(81, admin);

      expect(result.correctionProvenance).toEqual({
        source: 'CONTRACT_VOID',
        displayText: '\u56e0\u5408\u540c\u7ea0\u9519\u5df2\u51b2\u9500',
      });
      expect(result.receipt.correctionProvenance).toEqual(
        result.correctionProvenance,
      );
      expect(receipt.correctionProvenance).toEqual(result.correctionProvenance);
      expect(findFirst).toHaveBeenCalledWith({
        where: {
          originalEntityType: 'Payment',
          originalEntityId: 81,
        },
        select: { id: true },
      });
    },
  );

  it('does not mark an ordinary fully refunded payment as contract-corrected', async () => {
    const service = new PaymentsService({
      db: {
        payment: {
          findUnique: jest
            .fn()
            .mockResolvedValue({ ...payment, status: 'FULLY_REFUNDED' }),
        },
        contractVoidReversal: {
          findFirst: jest.fn().mockResolvedValue(null),
        },
        user: { findUnique: jest.fn().mockResolvedValue(null) },
        operationLog: { findMany: jest.fn().mockResolvedValue([]) },
      },
    } as never);

    const result = await service.detail(81, admin);

    expect(result.correctionProvenance).toBeNull();
    expect(result.receipt.correctionProvenance).toBeNull();
  });

  it('translates list filters to contract, room, tenant, receipt and date conditions', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const count = jest.fn().mockResolvedValue(0);
    const service = new PaymentsService({
      db: { payment: { findMany, count } },
    } as never);

    await service.list(
      {
        contractId: 7,
        roomKeyword: '1栋201',
        tenantKeyword: '张',
        receiptNo: 'SK-TEST',
        dateFrom: '2026-08-01',
        dateTo: '2026-08-31',
      },
      admin,
    );

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          contractId: 7,
          receiptNo: { contains: 'SK-TEST' },
          paymentDate: {
            gte: new Date('2026-08-01'),
            lte: new Date('2026-08-31'),
          },
          contract: expect.objectContaining({
            room: { fullHouseNo: { contains: '1栋201' } },
            members: expect.anything(),
          }),
        }),
      }),
    );
  });

  it('returns one server-side page with the filtered total', async () => {
    const findMany = jest.fn().mockResolvedValue([payment]);
    const count = jest.fn().mockResolvedValue(26);
    const service = new PaymentsService({
      db: { payment: { findMany, count } },
    } as never);

    const result = await service.list({ page: 3, pageSize: 10 }, admin);

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 20, take: 10 }),
    );
    expect(count).toHaveBeenCalledWith({ where: expect.any(Object) });
    expect(result).toMatchObject({
      page: 3,
      pageSize: 10,
      total: 26,
      items: [expect.objectContaining({ id: 81, paymentCategory: 'RENT' })],
    });
  });
});

describe('PaymentsService.edit', () => {
  const superAdmin = {
    id: 1,
    username: 'admin',
    displayName: '超级管理员',
    role: UserRole.SUPER_ADMIN,
  };

  function editFixture(
    refunds: Array<{ approvalStatus: string }> = [],
    paymentCategory = 'RENT',
    protectedAllocation: { id: number } | null = null,
    autoSourceKey: string | null = null,
    contractStatus = 'ACTIVE',
  ) {
    const payment = {
      id: 81,
      receiptNo: 'SK-TEST-81',
      contractId: 7,
      paymentDate: new Date('2026-08-04'),
      amount: '570.00',
      method: 'BANK_TRANSFER',
      externalReference: 'BANK-001',
      remark: '原备注',
      editReason: null,
      status: 'CONFIRMED',
      paymentCategory,
      contract: { status: contractStatus },
      autoSourceKey,
      allocations: [
        {
          id: 101,
          rentBillId: 11,
          allocatedAmount: '570.00',
          reversedAmount: '0.00',
          allocationOrder: 1,
        },
      ],
      prepaymentTransactions: [],
      refunds,
      voidRequests: [],
    };
    const bills = [
      {
        id: 11,
        contractId: 7,
        periodSeq: 1,
        dueDate: new Date('2026-08-01'),
        periodEnd: new Date('2026-08-31'),
        payableAmount: '600.00',
        receivedAmount: '570.00',
        outstandingAmount: '30.00',
        status: 'PARTIAL',
      },
    ];
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 81 }]),
      payment: {
        findUniqueOrThrow: jest.fn().mockResolvedValue(payment),
        update: jest.fn().mockResolvedValue({ ...payment, amount: '600.00' }),
      },
      rentBill: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce(bills)
          .mockResolvedValueOnce(bills),
        update: jest.fn().mockResolvedValue({}),
      },
      paymentAllocation: {
        findFirst: jest.fn().mockResolvedValue(protectedAllocation),
        update: jest.fn().mockResolvedValue({}),
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      prepaymentTransaction: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({}),
      },
      contract: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 7,
          startDate: new Date('2026-08-01'),
          pricingTiers: [],
        }),
        update: jest.fn().mockResolvedValue({}),
      },
      securityAuditLog: { create: jest.fn().mockResolvedValue({}) },
      operationLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      db: {
        $transaction: jest.fn(
          (callback: (value: typeof tx) => Promise<unknown>) => callback(tx),
        ),
      },
    };
    return { tx, prisma, service: new PaymentsService(prisma as never) };
  }

  it('rejects a non-super-administrator in the service layer', async () => {
    const { prisma, service } = editFixture();

    await expect(
      service.edit(
        81,
        { amount: '600.00', editReason: '修正录入金额' },
        { ...superAdmin, role: UserRole.ADMIN },
      ),
    ).rejects.toThrow('只有超级管理员可以修改已确认收款');
    expect(prisma.db.$transaction).not.toHaveBeenCalled();
  });

  it('rejects editing a payment for a voided contract', async () => {
    const { tx, service } = editFixture([], 'RENT', null, null, 'VOIDED');

    await expect(
      service.edit(
        81,
        { amount: '600.00', editReason: '修正录入金额' },
        superAdmin,
      ),
    ).rejects.toThrow('已作废合同不能修改收款');
    expect(tx.payment.update).not.toHaveBeenCalled();
  });

  it('blocks editing a checkout supplemental payment', async () => {
    const { tx, service } = editFixture([], 'CHECKOUT_SUPPLEMENTAL');

    await expect(
      service.edit(
        81,
        { amount: '600.00', editReason: '不应允许修改专用补收' },
        superAdmin,
      ),
    ).rejects.toThrow('退租补收款不能通过通用收款修改');
    expect(tx.paymentAllocation.update).not.toHaveBeenCalled();
  });

  it('blocks editing a contract automatic deposit payment', async () => {
    const { tx, service } = editFixture(
      [],
      'DEPOSIT',
      null,
      'CONTRACT_INITIAL_DEPOSIT:7',
    );

    await expect(
      service.edit(
        81,
        { amount: '600.00', editReason: '不应修改合同自动押金' },
        superAdmin,
      ),
    ).rejects.toThrow(
      '合同自动入账押金不能通过通用收款修改、退款或作废，请使用押金专用流程',
    );
    expect(tx.paymentAllocation.update).not.toHaveBeenCalled();
  });

  it('blocks editing a normal payment allocated to protected checkout arrears', async () => {
    const { tx, service } = editFixture([], 'RENT', { id: 101 });

    await expect(
      service.edit(
        81,
        { amount: '600.00', editReason: '不应改写已锁定欠租' },
        superAdmin,
      ),
    ).rejects.toThrow('该收款已用于退租补收锁定的欠租，不能修改、退款或作废');
    expect(tx.paymentAllocation.update).not.toHaveBeenCalled();
  });
  it('blocks editing while a confirmed or pending refund exists', async () => {
    const { service } = editFixture([{ approvalStatus: 'PENDING' }]);

    await expect(
      service.edit(
        81,
        { amount: '600.00', editReason: '修正录入金额' },
        superAdmin,
      ),
    ).rejects.toThrow('存在待处理或已确认退款，不能直接修改收款');
  });

  it('reverses old allocation, writes the corrected allocation and appends audit', async () => {
    const { tx, service } = editFixture();

    const result = await service.edit(
      81,
      {
        paymentDate: '2026-08-05',
        amount: '600.00',
        method: PaymentMethod.CASH,
        selectedBillIds: [11],
        remark: null,
        editReason: '银行流水录入错误，按现金收据修正',
      },
      superAdmin,
    );

    expect(result).toEqual({ id: 81, receiptNo: 'SK-TEST-81' });
    expect(tx.paymentAllocation.update).toHaveBeenCalledWith({
      where: { id: 101 },
      data: { reversedAmount: expect.anything() },
    });
    expect(tx.paymentAllocation.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          paymentId: 81,
          rentBillId: 11,
          allocatedAmount: expect.anything(),
          allocationOrder: 1,
        }),
      ],
    });
    expect(tx.payment.update).toHaveBeenCalledWith({
      where: { id: 81 },
      data: expect.objectContaining({
        amount: expect.anything(),
        method: PaymentMethod.CASH,
        remark: null,
        editReason: '银行流水录入错误，按现金收据修正',
      }),
    });
    expect(tx.payment.update).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          receiptNo: expect.anything(),
          contractId: expect.anything(),
        }),
      }),
    );
    expectContractMutationOrder(
      'payment.edit',
      tx.$queryRaw,
      tx.payment.findUniqueOrThrow,
      tx.paymentAllocation.update,
    );
    expect(tx.securityAuditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        eventType: 'PAYMENT_CORRECTED',
        entityId: 81,
        operatorId: 1,
        reason: '银行流水录入错误，按现金收据修正',
        eventData: expect.objectContaining({
          before: expect.objectContaining({ amount: '570.00' }),
          after: expect.objectContaining({ amount: '600.00' }),
        }),
      }),
    });
  });
});
