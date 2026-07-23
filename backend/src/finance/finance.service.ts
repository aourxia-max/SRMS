import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class FinanceService {
  constructor(private readonly prisma: PrismaService) {}
  async rentCollection(from?: string, to?: string) {
    const bills = await this.prisma.db.rentBill.findMany({
      where: {
        status: { not: 'VOIDED' },
        ...(from || to
          ? {
              periodStart: {
                ...(from ? { gte: new Date(from) } : {}),
                ...(to ? { lte: new Date(to) } : {}),
              },
            }
          : {}),
      },
      include: {
        contract: {
          include: {
            room: true,
            members: {
              where: { memberRole: 'PRIMARY', isCurrent: true },
              include: { tenant: true },
            },
          },
        },
        allocations: { include: { payment: true } },
      },
      orderBy: { periodStart: 'asc' },
    });
    const rows = bills.map((bill) => {
      const validReceived = bill.allocations
        .filter((item) =>
          ['CONFIRMED', 'PARTIALLY_REFUNDED'].includes(item.payment.status),
        )
        .reduce(
          (sum, item) =>
            sum.plus(
              new Prisma.Decimal(item.allocatedAmount).minus(
                item.reversedAmount,
              ),
            ),
          new Prisma.Decimal(0),
        );
      const netReceivable = new Prisma.Decimal(bill.payableAmount);
      return {
        billNo: bill.billNo,
        contractNo: bill.contract.contractNo,
        houseNo: bill.contract.room.fullHouseNo,
        tenantName: bill.contract.members[0]?.tenant.name ?? '',
        periodStart: bill.periodStart,
        originalReceivable: bill.baseRentAmount,
        concessionAmount: new Prisma.Decimal(bill.rentFreeAmount).plus(
          bill.discountAmount,
        ),
        netReceivable,
        validReceived,
        outstanding: Prisma.Decimal.max(0, netReceivable.minus(validReceived)),
        status: bill.status,
      };
    });
    const total = rows.reduce(
      (sum, row) => ({
        originalReceivable: sum.originalReceivable.plus(row.originalReceivable),
        concessionAmount: sum.concessionAmount.plus(row.concessionAmount),
        netReceivable: sum.netReceivable.plus(row.netReceivable),
        validReceived: sum.validReceived.plus(row.validReceived),
        outstanding: sum.outstanding.plus(row.outstanding),
      }),
      {
        originalReceivable: new Prisma.Decimal(0),
        concessionAmount: new Prisma.Decimal(0),
        netReceivable: new Prisma.Decimal(0),
        validReceived: new Prisma.Decimal(0),
        outstanding: new Prisma.Decimal(0),
      },
    );
    return {
      rows,
      total,
      collectionRate: total.netReceivable.isZero()
        ? null
        : total.validReceived
            .div(total.netReceivable)
            .mul(100)
            .toDecimalPlaces(2),
    };
  }
  async cashFlows(from?: string, to?: string) {
    const date =
      from || to
        ? {
            ...(from ? { gte: new Date(from) } : {}),
            ...(to ? { lte: new Date(to) } : {}),
          }
        : undefined;
    const [payments, refunds, deposits] = await Promise.all([
      this.prisma.db.payment.findMany({
        where: {
          status: { in: ['CONFIRMED', 'PARTIALLY_REFUNDED'] },
          ...(date ? { paymentDate: date } : {}),
        },
      }),
      this.prisma.db.paymentRefund.findMany({
        where: {
          approvalStatus: 'APPROVED',
          ...(date ? { refundDate: date } : {}),
        },
      }),
      this.prisma.db.depositTransaction.findMany({
        where: date ? { occurredAt: date } : {},
      }),
    ]);
    const flows = [
      ...payments.map((item) => ({
        date: item.paymentDate,
        type:
          item.paymentCategory === 'RENT'
            ? '租金收款'
            : item.paymentCategory === 'DEPOSIT'
              ? '押金收取'
              : '预收款收取',
        amount: item.amount,
        direction: 'IN',
        external: true,
        countsAsRentReceipt: item.paymentCategory === 'RENT',
        reference: item.receiptNo,
      })),
      ...refunds.map((item) => ({
        date: item.refundDate,
        type: '收款退款',
        amount: item.refundAmount,
        direction: 'OUT',
        external: true,
        countsAsRentReceipt: false,
        reference: item.refundNo,
      })),
      ...deposits
        .filter((item) =>
          ['OFFSET_ARREARS', 'OFFSET_SETTLEMENT'].includes(
            item.transactionType,
          ),
        )
        .map((item) => ({
          date: item.occurredAt,
          type: '押金内部抵扣',
          amount: item.amount,
          direction: 'OUT',
          external: false,
          countsAsRentReceipt: false,
          reference: item.transactionNo,
        })),
    ].sort((a, b) => b.date.getTime() - a.date.getTime());
    const inflow = flows
      .filter((item) => item.external && item.direction === 'IN')
      .reduce((sum, item) => sum.plus(item.amount), new Prisma.Decimal(0));
    const outflow = flows
      .filter((item) => item.external && item.direction === 'OUT')
      .reduce((sum, item) => sum.plus(item.amount), new Prisma.Decimal(0));
    return { flows, inflow, outflow, netCashFlow: inflow.minus(outflow) };
  }
}
