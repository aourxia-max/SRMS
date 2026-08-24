import { Prisma } from '@prisma/client';
import { CheckoutService } from './checkout.service';

describe('CheckoutService.preview', () => {
  it('calculates pending-start checkout amounts without writing financial records', async () => {
    const db = {
      checkoutSettlement: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 8,
          status: 'DRAFT',
          contractId: 3,
          originContractStatus: 'PENDING_START',
          contract: {
            status: 'PENDING_CHECKOUT',
            startDate: new Date('2026-09-01'),
            bills: [
              {
                id: 11,
                periodStart: new Date('2026-08-01'),
                status: 'PENDING',
                outstandingAmount: new Prisma.Decimal('1600.00'),
              },
              {
                id: 12,
                periodStart: new Date('2026-09-01'),
                status: 'PENDING',
                outstandingAmount: new Prisma.Decimal('1600.00'),
              },
            ],
          },
        }),
      },
      depositTransaction: {
        findFirst: jest.fn().mockResolvedValue({ balanceAfter: '10000.00' }),
      },
      prepaymentTransaction: {
        findFirst: jest.fn().mockResolvedValue({ balanceAfter: '500.00' }),
      },
    };
    const service = new CheckoutService({ db } as never);

    await expect(
      service.preview(8, {
        actualCheckoutDate: '2026-08-20',
        handoverDate: '2026-08-20',
        inspectionAt: '2026-08-20T09:00:00.000Z',
        targetRoomStatus: 'EMPTY',
        items: [
          {
            itemType: 'OTHER',
            amount: '2000.00',
            inspectionRecordRef: 'YF-001',
            description: '合同约定扣款',
          },
        ],
      } as never),
    ).resolves.toEqual({
      depositOffsetAmount: '1600.00',
      otherDeductionAmount: '2000.00',
      depositRefundableAmount: '6400.00',
      prepaymentRefundableAmount: '500.00',
      totalRefundAmount: '6900.00',
      supplementalArrearsAmount: '0.00',
      supplementalInspectionAmount: '0.00',
      finalReceivable: '0.00',
    });
    expect(Object.keys(db.checkoutSettlement)).toEqual(['findUniqueOrThrow']);
  });
});
