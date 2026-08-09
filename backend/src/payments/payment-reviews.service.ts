import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import type { AuthUser } from '../auth/auth-user.type';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentReviewQueryDto } from './dto/payment-review-query.dto';

@Injectable()
export class PaymentReviewsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: PaymentReviewQueryDto, user: AuthUser) {
    const paymentWhere = {
      ...(query.contractId ? { contractId: query.contractId } : {}),
      ...(query.roomKeyword || query.tenantKeyword
        ? {
            contract: {
              ...(query.roomKeyword
                ? {
                    room: {
                      fullHouseNo: { contains: query.roomKeyword },
                    },
                  }
                : {}),
              ...(query.tenantKeyword
                ? {
                    members: {
                      some: {
                        isCurrent: true,
                        tenant: { name: { contains: query.tenantKeyword } },
                      },
                    },
                  }
                : {}),
            },
          }
        : {}),
    } satisfies Prisma.PaymentWhereInput;
    const submittedAt =
      query.dateFrom || query.dateTo
        ? {
            ...(query.dateFrom ? { gte: new Date(query.dateFrom) } : {}),
            ...(query.dateTo
              ? {
                  lt: new Date(
                    new Date(query.dateTo).getTime() + 24 * 60 * 60 * 1000,
                  ),
                }
              : {}),
          }
        : undefined;
    const include = {
      payment: {
        include: {
          contract: {
            include: {
              room: true,
              members: {
                where: { memberRole: 'PRIMARY' as const, isCurrent: true },
                include: { tenant: true },
              },
            },
          },
        },
      },
    };
    const refunds =
      query.type === 'VOID'
        ? []
        : await this.prisma.db.paymentRefund.findMany({
            where: {
              ...(query.status ? { approvalStatus: query.status } : {}),
              ...(submittedAt ? { submittedAt } : {}),
              payment: paymentWhere,
            },
            include,
            orderBy: { submittedAt: 'desc' },
          });
    const voids =
      query.type === 'REFUND'
        ? []
        : await this.prisma.db.paymentVoidRequest.findMany({
            where: {
              ...(query.status ? { approvalStatus: query.status } : {}),
              ...(submittedAt ? { submittedAt } : {}),
              payment: paymentWhere,
            },
            include,
            orderBy: { submittedAt: 'desc' },
          });
    const items = [
      ...refunds.map((item) =>
        this.presentQueueItem(
          'REFUND',
          item.id,
          item.refundNo,
          item.approvalStatus,
          item.submittedAt,
          item.payment,
          user,
          item.refundAmount,
        ),
      ),
      ...voids.map((item) =>
        this.presentQueueItem(
          'VOID',
          item.id,
          item.requestNo,
          item.approvalStatus,
          item.submittedAt,
          item.payment,
          user,
        ),
      ),
    ];
    return items.sort((left, right) => {
      const pendingDifference =
        Number(right.status === 'PENDING') - Number(left.status === 'PENDING');
      return (
        pendingDifference ||
        right.submittedAt.getTime() - left.submittedAt.getTime()
      );
    });
  }

  async detail(type: 'REFUND' | 'VOID', id: number, user: AuthUser) {
    if (type === 'REFUND') {
      const refund = await this.prisma.db.paymentRefund.findUnique({
        where: { id },
        include: {
          allocations: {
            include: { paymentAllocation: { include: { rentBill: true } } },
          },
          adjustmentDecisions: {
            include: {
              billAdjustment: true,
              reversalAdjustment: true,
            },
          },
          payment: {
            include: {
              adjustments: true,
              contract: {
                include: {
                  room: true,
                  members: {
                    where: { memberRole: 'PRIMARY', isCurrent: true },
                    include: { tenant: true },
                  },
                },
              },
            },
          },
        },
      });
      if (!refund) throw new NotFoundException('退款申请不存在');
      return {
        type,
        ...refund,
        tenant: this.tenant(refund.payment.contract.members[0]?.tenant, user),
      };
    }
    const request = await this.prisma.db.paymentVoidRequest.findUnique({
      where: { id },
      include: {
        payment: {
          include: {
            allocations: { include: { rentBill: true } },
            prepaymentTransactions: true,
            adjustments: true,
            contract: {
              include: {
                room: true,
                members: {
                  where: { memberRole: 'PRIMARY', isCurrent: true },
                  include: { tenant: true },
                },
              },
            },
          },
        },
      },
    });
    if (!request) throw new NotFoundException('作废申请不存在');
    return {
      type,
      ...request,
      tenant: this.tenant(request.payment.contract.members[0]?.tenant, user),
    };
  }

  private presentQueueItem(
    type: 'REFUND' | 'VOID',
    id: number,
    requestNo: string,
    status: string,
    submittedAt: Date,
    payment: {
      id: number;
      receiptNo: string;
      contract: {
        id: number;
        contractNo: string;
        room: { id: number; fullHouseNo: string };
        members: Array<{
          tenant: { id: number; name: string; phone: string | null };
        }>;
      };
    },
    user: AuthUser,
    amount?: Prisma.Decimal.Value,
  ) {
    return {
      type,
      id,
      requestNo,
      status,
      submittedAt,
      amount:
        amount === undefined ? null : new Prisma.Decimal(amount).toFixed(2),
      paymentId: payment.id,
      receiptNo: payment.receiptNo,
      contract: {
        id: payment.contract.id,
        contractNo: payment.contract.contractNo,
        room: payment.contract.room,
      },
      tenant: this.tenant(payment.contract.members[0]?.tenant, user),
    };
  }

  private tenant(
    tenant: { id: number; name: string; phone: string | null } | undefined,
    user: AuthUser,
  ) {
    if (!tenant) return null;
    if (user.role !== UserRole.VISITOR) return tenant;
    return {
      id: tenant.id,
      name: tenant.name ? `${tenant.name.slice(0, 1)}*` : '',
      phone: tenant.phone
        ? `${tenant.phone.slice(0, 3)}****${tenant.phone.slice(-4)}`
        : null,
    };
  }
}
