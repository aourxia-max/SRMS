import { Prisma } from '@prisma/client';
import { CheckoutService } from './checkout.service';
import { DepositRefundsService } from './deposit-refunds.service';

function checkoutDetail(
  status: 'APPROVED' | 'COMPLETED',
  allocations: Array<{
    paymentAllocationId: number;
    status: 'RESERVED' | 'RELEASED' | 'APPLIED';
  }>,
) {
  return {
    id: 2,
    status,
    rentReceivable: '0.00',
    rentReceived: '0.00',
    rentOutstanding: '0.00',
    prepaymentBalance: '0.00',
    depositBalance: '500.00',
    depositOffsetAmount: '0.00',
    otherDeductionAmount: '0.00',
    depositRefundableAmount: new Prisma.Decimal('500.00'),
    prepaymentRefundableAmount: new Prisma.Decimal('20.00'),
    rentRefundableAmount: new Prisma.Decimal('100.00'),
    finalReceivable: '0.00',
    supplementalRequired: false,
    supplementalArrearsAmount: '0.00',
    supplementalInspectionAmount: '0.00',
    supplementalReceivedAmount: '0.00',
    supplementalOutstandingAmount: '0.00',
    supplementalCollectedAt: null,
    contract: { id: 3, room: { id: 7 } },
    items: [
      {
        id: 81,
        itemType: 'RENT_REFUND',
        amount: '100.00',
        checkoutRentRefundAllocations: allocations.map((allocation) => ({
          ...allocation,
          id: allocation.paymentAllocationId + 100,
          reservedAmount: '100.00',
          rentBill: {
            billNo: `ZJ-${allocation.paymentAllocationId}`,
            periodStart: new Date('2026-09-01'),
            periodEnd: new Date('2026-09-30'),
          },
        })),
      },
    ],
    depositRefunds: [],
  };
}

function settlement(id = 1) {
  return {
    id,
    contractId: id + 100,
    status: 'APPROVED',
    handoverDate: new Date('2026-08-01'),
    finalReceivable: '0.00',
    depositRefundableAmount: '800.00',
    prepaymentRefundableAmount: '0.00',
    rentRefundableAmount: '0.00',
    contract: { id: id + 100, status: 'PENDING_CHECKOUT' },
  };
}

function refundDto(checkoutSettlementId = 1, proofFileIds = [4]) {
  return {
    checkoutSettlementId,
    refundAmount: '800.00',
    refundDate: '2026-08-02',
    refundMethod: 'BANK_TRANSFER',
    proofFileIds,
  } as never;
}

const admin = { id: 2, username: 'admin', role: 'ADMIN' } as const;

describe('Task 8 combined checkout refund hardening', () => {
  it.each([
    ['APPROVED', 'RESERVED', 18],
    ['COMPLETED', 'APPLIED', 20],
  ] as const)(
    'returns the Decimal locked total and only %s-visible allocation history',
    async (status, expectedStatus, expectedAllocationId) => {
      const findUniqueOrThrow = jest.fn().mockResolvedValue(
        checkoutDetail(status, [
          { paymentAllocationId: 18, status: 'RESERVED' },
          { paymentAllocationId: 19, status: 'RELEASED' },
          { paymentAllocationId: 20, status: 'APPLIED' },
        ]),
      );
      const service = new CheckoutService({
        db: { checkoutSettlement: { findUniqueOrThrow } },
      } as never);

      const result = await service.getDetail(2);

      expect(result).toMatchObject({
        depositRefundableAmount: '500.00',
        prepaymentRefundableAmount: '20.00',
        rentRefundableAmount: '100.00',
        totalRefundAmount: '620.00',
        rentRefundAllocations: [
          expect.objectContaining({
            paymentAllocationId: expectedAllocationId,
            status: expectedStatus,
            amount: '100.00',
          }),
        ],
      });
      expect(result.rentRefundAllocations).toHaveLength(1);
    },
  );

  it('rejects a proof uploaded by another user before creating a pending combined refund', async () => {
    const create = jest.fn().mockResolvedValue({ id: 9 });
    const client = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 1 }]),
      checkoutSettlement: {
        findUniqueOrThrow: jest.fn().mockResolvedValue(settlement()),
      },
      depositRefund: { findFirst: jest.fn().mockResolvedValue(null), create },
      fileAsset: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 4,
            category: 'DEPOSIT_REFUND_PROOF',
            uploadedBy: 99,
            lockedAt: null,
          },
        ]),
      },
    };
    const service = new DepositRefundsService({
      db: {
        ...client,
        $transaction: jest.fn((callback: (tx: typeof client) => unknown) =>
          callback(client),
        ),
      },
    } as never);

    await expect(service.submit(refundDto(), admin)).rejects.toThrow(
      '合并退款凭证必须由当前用户上传且未被其他退款占用',
    );
    expect(create).not.toHaveBeenCalled();
  });

  it('rejects a second active refund for the same locked settlement', async () => {
    const create = jest.fn();
    const client = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 1 }]),
      checkoutSettlement: {
        findUniqueOrThrow: jest.fn().mockResolvedValue(settlement()),
      },
      depositRefund: {
        findFirst: jest.fn().mockResolvedValue({ id: 88 }),
        create,
      },
      fileAsset: { findMany: jest.fn() },
    };
    const service = new DepositRefundsService({
      db: {
        ...client,
        $transaction: jest.fn((callback: (tx: typeof client) => unknown) =>
          callback(client),
        ),
      },
    } as never);

    await expect(service.submit(refundDto(), admin)).rejects.toThrow(
      '该结算单已存在待确认或已确认的合并退款',
    );
    expect(create).not.toHaveBeenCalled();
  });

  it('allows only one of two concurrent submissions to claim the same proof across settlements', async () => {
    type ActiveRefund = {
      id: number;
      checkoutSettlementId: number;
      proofFileIds: number[];
      approvalStatus: 'PENDING';
    };
    const activeRefunds: ActiveRefund[] = [];
    let transactionGate = Promise.resolve();
    const db = {
      $transaction: jest.fn(async (callback: (tx: any) => Promise<unknown>) => {
        let release!: () => void;
        const previous = transactionGate;
        transactionGate = new Promise<void>((resolve) => {
          release = resolve;
        });
        await previous;
        const tx = {
          $queryRaw: jest.fn().mockResolvedValue([{ id: 1 }]),
          checkoutSettlement: {
            findUniqueOrThrow: jest.fn(({ where }: { where: { id: number } }) =>
              Promise.resolve(settlement(where.id)),
            ),
          },
          depositRefund: {
            findFirst: jest.fn(({ where }: any) =>
              Promise.resolve(
                activeRefunds.find(
                  (refund) =>
                    refund.checkoutSettlementId === where.checkoutSettlementId,
                ) ?? null,
              ),
            ),
            create: jest.fn(({ data }: any) => {
              const created = {
                id: activeRefunds.length + 1,
                checkoutSettlementId: data.checkoutSettlementId,
                proofFileIds: data.files.create.map(
                  (file: { fileAssetId: number }) => file.fileAssetId,
                ),
                approvalStatus: 'PENDING' as const,
              };
              activeRefunds.push(created);
              return Promise.resolve(created);
            }),
          },
          fileAsset: {
            findMany: jest.fn(({ where }: any) => {
              const excludesActiveRefunds = Boolean(
                where.depositRefundFiles?.none?.depositRefund?.approvalStatus,
              );
              const alreadyClaimed = activeRefunds.some((refund) =>
                refund.proofFileIds.includes(4),
              );
              return Promise.resolve(
                excludesActiveRefunds && alreadyClaimed
                  ? []
                  : [
                      {
                        id: 4,
                        category: 'DEPOSIT_REFUND_PROOF',
                        uploadedBy: 2,
                        lockedAt: null,
                      },
                    ],
              );
            }),
          },
        };
        try {
          return await callback(tx);
        } finally {
          release();
        }
      }),
    };
    const service = new DepositRefundsService({ db } as never);

    const results = await Promise.allSettled([
      service.submit(refundDto(1), admin),
      service.submit(refundDto(2), admin),
    ]);

    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === 'rejected'),
    ).toHaveLength(1);
    const rejected = results.find(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );
    expect(String(rejected?.reason?.message)).toContain(
      '合并退款凭证必须由当前用户上传且未被其他退款占用',
    );
    expect(activeRefunds).toHaveLength(1);
  });
});
