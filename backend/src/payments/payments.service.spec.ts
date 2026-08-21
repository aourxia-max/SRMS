import { BillAdjustmentType, PaymentMethod, UserRole } from '@prisma/client';
import { PaymentsService } from './payments.service';

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
          .mockResolvedValueOnce({ id: 7, startDate: new Date('2026-08-01') })
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

  it('masks tenant identity for a visitor', async () => {
    const service = new PaymentsService({
      db: {
        payment: { findUnique: jest.fn().mockResolvedValue(payment) },
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
      items: [expect.objectContaining({ id: 81 })],
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

  function editFixture(refunds: Array<{ approvalStatus: string }> = []) {
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
