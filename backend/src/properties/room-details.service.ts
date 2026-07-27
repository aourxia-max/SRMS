import { Injectable } from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import type { AuthUser } from '../auth/auth-user.type';
import { PrismaService } from '../prisma/prisma.service';

const activeStatuses = ['ACTIVE', 'PENDING_START', 'PENDING_CHECKOUT'];

@Injectable()
export class RoomDetailsService {
  constructor(private readonly prisma: PrismaService) {}

  async detail(roomId: number, user: AuthUser) {
    const room = await this.prisma.db.room.findFirstOrThrow({
      where: { id: roomId, deletedAt: null },
      include: {
        building: true,
        histories: { orderBy: { changedAt: 'desc' } },
        contracts: {
          orderBy: { startDate: 'desc' },
          include: {
            members: { where: { isCurrent: true }, include: { tenant: true } },
            bills: {
              select: {
                id: true,
                dueDate: true,
                outstandingAmount: true,
                status: true,
              },
            },
          },
        },
      },
    });
    const focus =
      room.contracts.find((contract) =>
        activeStatuses.includes(contract.status),
      ) ??
      room.contracts[0] ??
      null;
    const now = new Date();
    const riskLabels: string[] = [];
    if (room.roomStatus === 'MAINTENANCE') riskLabels.push('维修中');
    if (
      focus?.bills.some(
        (bill) =>
          bill.dueDate < now &&
          new Prisma.Decimal(bill.outstandingAmount).gt(0) &&
          !['VOIDED', 'REFUNDED'].includes(bill.status),
      )
    )
      riskLabels.push('有逾期账单');
    if (focus) {
      const in30 = new Date(now);
      in30.setDate(in30.getDate() + 30);
      if (focus.endDate >= now && focus.endDate <= in30)
        riskLabels.push('合同即将到期');
    }
    if (!riskLabels.length) riskLabels.push('当前无待办');

    const contracts = room.contracts.map(({ bills, ...contract }) => ({
      ...contract,
      hasOverdueBill: bills.some(
        (bill) =>
          bill.dueDate < now &&
          new Prisma.Decimal(bill.outstandingAmount).gt(0) &&
          !['VOIDED', 'REFUNDED'].includes(bill.status),
      ),
    }));
    const result: Record<string, unknown> = {
      room: { ...room, contracts },
      focusContractId: focus?.id ?? null,
      riskLabels,
    };
    if (user.role === UserRole.SUPER_ADMIN && focus) {
      const [bills, payments, prepayments, refunds] = await Promise.all([
        this.prisma.db.rentBill.findMany({
          where: { contractId: focus.id, status: { not: 'VOIDED' } },
          orderBy: { periodSeq: 'asc' },
        }),
        this.prisma.db.payment.findMany({
          where: { contractId: focus.id },
          include: { allocations: { include: { rentBill: true } } },
          orderBy: { id: 'desc' },
        }),
        this.prisma.db.prepaymentTransaction.findMany({
          where: { contractId: focus.id },
          orderBy: { id: 'desc' },
        }),
        this.prisma.db.paymentRefund.findMany({
          where: { contractId: focus.id },
          orderBy: { id: 'desc' },
        }),
      ]);
      const total = bills.reduce(
        (sum, bill) => ({
          payable: sum.payable.plus(bill.payableAmount),
          received: sum.received.plus(bill.receivedAmount),
          outstanding: sum.outstanding.plus(bill.outstandingAmount),
        }),
        {
          payable: new Prisma.Decimal(0),
          received: new Prisma.Decimal(0),
          outstanding: new Prisma.Decimal(0),
        },
      );
      result.financial = {
        contractId: focus.id,
        summary: total,
        bills,
        payments,
        prepaymentBalance:
          prepayments[0]?.balanceAfter ?? new Prisma.Decimal(0),
        refunds,
      };
    }
    return result;
  }
}
