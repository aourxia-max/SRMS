import { UserRole } from '@prisma/client';
import { PaymentReviewsService } from './payment-reviews.service';

describe('PaymentReviewsService', () => {
  const contract = {
    id: 7,
    contractNo: 'HT-000007-20260801-1栋201',
    room: { id: 21, fullHouseNo: '1栋201' },
    members: [
      {
        tenant: { id: 9, name: '张三', phone: '13800008000' },
      },
    ],
  };

  it('merges refund and void requests with pending items first', async () => {
    const service = new PaymentReviewsService({
      db: {
        paymentRefund: {
          findMany: jest.fn().mockResolvedValue([
            {
              id: 201,
              refundNo: 'TK-201',
              refundAmount: '100.00',
              submittedAt: new Date('2026-08-03'),
              approvalStatus: 'APPROVED',
              payment: { id: 81, receiptNo: 'SK-81', contract },
            },
          ]),
        },
        paymentVoidRequest: {
          findMany: jest.fn().mockResolvedValue([
            {
              id: 301,
              requestNo: 'ZF-301',
              submittedAt: new Date('2026-08-02'),
              approvalStatus: 'PENDING',
              payment: { id: 82, receiptNo: 'SK-82', contract },
            },
          ]),
        },
      },
    } as never);

    const result = await service.list(
      {},
      {
        id: 1,
        username: 'admin',
        displayName: '超级管理员',
        role: UserRole.SUPER_ADMIN,
      },
    );

    expect(result.map((item) => [item.type, item.id, item.status])).toEqual([
      ['VOID', 301, 'PENDING'],
      ['REFUND', 201, 'APPROVED'],
    ]);
  });

  it('masks tenant identity in the visitor review queue', async () => {
    const service = new PaymentReviewsService({
      db: {
        paymentRefund: {
          findMany: jest.fn().mockResolvedValue([
            {
              id: 201,
              refundNo: 'TK-201',
              refundAmount: '100.00',
              submittedAt: new Date('2026-08-03'),
              approvalStatus: 'PENDING',
              payment: { id: 81, receiptNo: 'SK-81', contract },
            },
          ]),
        },
        paymentVoidRequest: { findMany: jest.fn().mockResolvedValue([]) },
      },
    } as never);

    const [item] = await service.list(
      {},
      {
        id: 5,
        username: 'visitor',
        displayName: '访客',
        role: UserRole.VISITOR,
      },
    );

    expect(item.tenant).toEqual({
      id: 9,
      name: '张*',
      phone: '138****8000',
    });
  });
});
