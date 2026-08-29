import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, RentBillStatus } from '@prisma/client';
import { contractBusinessDay } from '../contracts/contract-business-day';
import { PrismaService } from '../prisma/prisma.service';
import { ListRentBillsDto } from './dto/list-rent-bills.dto';

const rentBillInclude = {
  contract: {
    include: {
      room: { include: { building: true } },
      members: {
        where: { memberRole: 'PRIMARY', isCurrent: true },
        include: { tenant: { select: { id: true, name: true } } },
      },
    },
  },
} satisfies Prisma.RentBillInclude;

const rentBillDetailInclude = {
  ...rentBillInclude,
  adjustments: {
    orderBy: { id: 'desc' },
    select: {
      id: true,
      adjustmentNo: true,
      adjustmentType: true,
      direction: true,
      amount: true,
      approvalStatus: true,
      reason: true,
      submittedAt: true,
    },
  },
  allocations: {
    orderBy: { id: 'asc' },
    select: {
      id: true,
      allocatedAmount: true,
      reversedAmount: true,
      payment: { select: { receiptNo: true, paymentDate: true, status: true } },
    },
  },
  prepaymentTransactions: {
    orderBy: { id: 'desc' },
    select: {
      id: true,
      transactionNo: true,
      transactionType: true,
      amount: true,
      occurredAt: true,
    },
  },
} satisfies Prisma.RentBillInclude;

type RentBillRow = Prisma.RentBillGetPayload<{
  include: typeof rentBillInclude;
}>;
type RentBillDetailRow = Prisma.RentBillGetPayload<{
  include: typeof rentBillDetailInclude;
}>;
const money = (value: Prisma.Decimal | string | number) =>
  new Prisma.Decimal(value).toFixed(2);

@Injectable()
export class RentBillsService {
  constructor(private readonly prisma: PrismaService) {}

  private async reconcileOverdueBills(now = new Date()) {
    await this.prisma.db.rentBill.updateMany({
      where: {
        dueDate: { lt: contractBusinessDay(now) },
        outstandingAmount: { gt: 0 },
        status: { in: ['PENDING', 'PARTIAL'] },
      },
      data: { status: 'OVERDUE' },
    });
  }

  private where(dto: ListRentBillsDto): Prisma.RentBillWhereInput {
    const keyword = dto.keyword?.trim();
    const where: Prisma.RentBillWhereInput = {
      billCategory: 'RENT',
      ...(dto.status ? { status: dto.status } : {}),
      ...(dto.buildingId
        ? { contract: { room: { buildingId: dto.buildingId } } }
        : {}),
    };
    if (dto.month) {
      const [year, month] = dto.month.split('-').map(Number);
      where.periodStart = {
        gte: new Date(Date.UTC(year, month - 1, 1)),
        lt: new Date(Date.UTC(year, month, 1)),
      };
    }
    if (keyword) {
      where.OR = [
        { billNo: { contains: keyword } },
        { contract: { contractNo: { contains: keyword } } },
        { contract: { room: { fullHouseNo: { contains: keyword } } } },
        {
          contract: {
            members: {
              some: {
                memberRole: 'PRIMARY',
                isCurrent: true,
                tenant: { name: { contains: keyword } },
              },
            },
          },
        },
      ];
    }
    return where;
  }

  private mapRow(bill: RentBillRow) {
    const member = bill.contract.members[0];
    return {
      id: bill.id,
      billNo: bill.billNo,
      room: {
        id: bill.contract.room.id,
        fullHouseNo: bill.contract.room.fullHouseNo,
        buildingId: bill.contract.room.buildingId,
        buildingName:
          bill.contract.room.building.buildingName ||
          bill.contract.room.building.buildingNo,
      },
      contract: { id: bill.contract.id, contractNo: bill.contract.contractNo },
      tenant: member?.tenant ?? null,
      periodStart: bill.periodStart,
      periodEnd: bill.periodEnd,
      dueDate: bill.dueDate,
      baseRentAmount: money(bill.baseRentAmount),
      rentFreeAmount: money(bill.rentFreeAmount),
      discountAmount: money(bill.discountAmount),
      payableAmount: money(bill.payableAmount),
      receivedAmount: money(bill.receivedAmount),
      outstandingAmount: money(bill.outstandingAmount),
      status: bill.status,
    };
  }

  async list(dto: ListRentBillsDto) {
    const where = this.where(dto);
    await this.reconcileOverdueBills();
    const [all, total] = await Promise.all([
      this.prisma.db.rentBill.findMany({
        where,
        include: rentBillInclude,
        orderBy: [{ periodStart: 'desc' }, { id: 'desc' }],
      }),
      this.prisma.db.rentBill.count({ where }),
    ]);
    const businessRows = all.filter(
      (item) =>
        !(['VOIDED', 'REFUNDED'] as RentBillStatus[]).includes(item.status) &&
        item.contract.status !== 'VOIDED',
    );
    const summary = businessRows.reduce(
      (result, bill) => {
        result.payable = result.payable.plus(bill.payableAmount);
        result.received = result.received.plus(bill.receivedAmount);
        result.outstanding = result.outstanding.plus(bill.outstandingAmount);
        if (bill.status === 'OVERDUE') result.overdueCount += 1;
        return result;
      },
      {
        payable: new Prisma.Decimal(0),
        received: new Prisma.Decimal(0),
        outstanding: new Prisma.Decimal(0),
        overdueCount: 0,
      },
    );
    const page = dto.page ?? 1;
    const pageSize = dto.pageSize ?? 20;
    return {
      items: all
        .slice((page - 1) * pageSize, page * pageSize)
        .map((bill) => this.mapRow(bill)),
      page,
      pageSize,
      total,
      summary: {
        payable: money(summary.payable),
        received: money(summary.received),
        outstanding: money(summary.outstanding),
        count: businessRows.length,
        overdueCount: summary.overdueCount,
      },
    };
  }

  async detail(id: number) {
    const bill: RentBillDetailRow | null =
      await this.prisma.db.rentBill.findUnique({
        where: { id },
        include: rentBillDetailInclude,
      });
    if (!bill) throw new NotFoundException('租金账单不存在');
    return {
      ...this.mapRow(bill),
      adjustments: bill.adjustments.map((item) => ({
        ...item,
        amount: money(item.amount),
      })),
      allocations: bill.allocations.map((item) => ({
        ...item,
        allocatedAmount: money(item.allocatedAmount),
        reversedAmount: money(item.reversedAmount),
      })),
      prepaymentTransactions: bill.prepaymentTransactions.map((item) => ({
        ...item,
        amount: money(item.amount),
      })),
    };
  }
}
