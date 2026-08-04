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
});
