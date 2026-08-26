import { Injectable } from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import type { AuthUser } from '../auth/auth-user.type';
import { FinanceService } from '../finance/finance.service';
import { PrismaService } from '../prisma/prisma.service';
import { currentMonthPeriod } from './rent-collection-overview';
@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly finance: FinanceService,
  ) {}
  async summary(
    user: AuthUser,
    buildingId?: number,
    statuses?: string[],
  ): Promise<Record<string, unknown>> {
    const now = new Date();
    const settings = await this.prisma.db.systemSetting.findMany({
      where: {
        settingKey: {
          in: ['rentReminderDays', 'contractExpiryDays', 'longVacancyDays'],
        },
      },
    });
    const settingValues = Object.fromEntries(
      settings.map((item) => [item.settingKey, Number(item.settingValue)]),
    );
    const rentReminderDays = settingValues.rentReminderDays || 7;
    const contractExpiryDays = settingValues.contractExpiryDays || 30;
    const longVacancyDays = settingValues.longVacancyDays || 30;
    const longVacancyBefore = new Date(now);
    longVacancyBefore.setDate(longVacancyBefore.getDate() - longVacancyDays);
    const in7 = new Date(now);
    in7.setDate(in7.getDate() + rentReminderDays);
    const in30 = new Date(now);
    in30.setDate(in30.getDate() + contractExpiryDays);
    const monthPeriod = currentMonthPeriod(now);
    const monthFrom = new Date(monthPeriod.from);
    const monthTo = new Date(monthPeriod.to);
    const canViewRoomRent = user.role === UserRole.SUPER_ADMIN;
    const rooms = await this.prisma.db.room.findMany({
      where: {
        deletedAt: null,
        ...(buildingId ? { buildingId } : {}),
        ...(statuses?.length
          ? { roomStatus: { in: statuses as never[] } }
          : {}),
      },
      include: {
        building: true,
        ...(canViewRoomRent
          ? {
              contracts: {
                where: {
                  status: {
                    in: ['PENDING_START', 'ACTIVE', 'PENDING_CHECKOUT'],
                  },
                },
                select: { status: true, monthlyRent: true, startDate: true },
                orderBy: { startDate: 'asc' as const },
              },
            }
          : {}),
      },
      orderBy: [{ buildingId: 'asc' }, { floorNo: 'asc' }, { houseNo: 'asc' }],
    });
    const roomSummaries = rooms.map((room) => {
      const roomWithContracts = room;
      const { contracts = [], ...summary } = roomWithContracts;
      if (!canViewRoomRent) return summary;
      const expectedContractStatus =
        room.roomStatus === 'PENDING_MOVE_IN'
          ? 'PENDING_START'
          : room.roomStatus === 'RENTED'
            ? 'ACTIVE'
            : room.roomStatus === 'PENDING_CHECKOUT'
              ? 'PENDING_CHECKOUT'
              : null;
      const currentContract = expectedContractStatus
        ? contracts.find(
            (contract) => contract.status === expectedContractStatus,
          )
        : undefined;
      return {
        ...summary,
        currentMonthlyRent: currentContract?.monthlyRent.toString() ?? null,
      };
    });
    const operating = rooms.filter((item) =>
      [
        'EMPTY',
        'PENDING_MOVE_IN',
        'RENTED',
        'PENDING_CHECKOUT',
        'MAINTENANCE',
      ].includes(item.roomStatus),
    );
    const statusCounts = rooms.reduce<Record<string, number>>(
      (all, item) => ({
        ...all,
        [item.roomStatus]: (all[item.roomStatus] ?? 0) + 1,
      }),
      {},
    );
    const [
      reminders,
      arrears,
      expiring,
      longVacancyRooms,
      adjustments,
      refunds,
      rebates,
      rentCollection,
      monthlyMoveInCount,
      monthlyCheckoutCount,
    ] = await Promise.all([
      this.prisma.db.rentBill.findMany({
        where: {
          billCategory: 'RENT',
          dueDate: { gte: now, lte: in7 },
          outstandingAmount: { gt: 0 },
          status: { notIn: ['VOIDED', 'REFUNDED'] },
          contract: { status: { not: 'VOIDED' } },
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
        },
        orderBy: { dueDate: 'asc' },
      }),
      this.prisma.db.rentBill.findMany({
        where: {
          billCategory: 'RENT',
          dueDate: { lt: now },
          outstandingAmount: { gt: 0 },
          status: { notIn: ['VOIDED', 'REFUNDED'] },
          contract: { status: { not: 'VOIDED' } },
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
        },
        orderBy: { dueDate: 'asc' },
      }),
      this.prisma.db.contract.findMany({
        where: {
          status: { in: ['ACTIVE', 'PENDING_CHECKOUT'] },
          endDate: { gte: now, lte: in30 },
        },
        include: { room: true },
        orderBy: { endDate: 'asc' },
      }),
      this.prisma.db.room.findMany({
        where: {
          deletedAt: null,
          roomStatus: 'EMPTY',
          statusChangedAt: { lte: longVacancyBefore },
        },
        include: { building: true },
        orderBy: { statusChangedAt: 'asc' },
      }),
      this.prisma.db.billAdjustment.findMany({
        where: { approvalStatus: 'PENDING' },
        select: {
          rentBill: {
            select: {
              contract: {
                select: { room: { select: { id: true, fullHouseNo: true } } },
              },
            },
          },
        },
      }),
      this.prisma.db.paymentRefund.findMany({
        where: { approvalStatus: 'PENDING' },
        select: {
          contract: {
            select: { room: { select: { id: true, fullHouseNo: true } } },
          },
        },
      }),
      this.prisma.db.pricingRebate.findMany({
        where: { approvalStatus: 'PENDING' },
        select: {
          contract: {
            select: { room: { select: { id: true, fullHouseNo: true } } },
          },
        },
      }),
      user.role === UserRole.SUPER_ADMIN
        ? this.finance.rentCollection(monthPeriod.from, monthPeriod.to)
        : Promise.resolve(null),
      this.prisma.db.contract.count({
        where: {
          status: { notIn: ['DRAFT', 'VOIDED'] },
          startDate: { gte: monthFrom, lte: monthTo },
          ...(buildingId ? { room: { buildingId } } : {}),
        },
      }),
      this.prisma.db.checkoutSettlement.count({
        where: {
          status: 'COMPLETED',
          actualCheckoutDate: { gte: monthFrom, lte: monthTo },
          ...(buildingId ? { contract: { room: { buildingId } } } : {}),
        },
      }),
    ]);
    const approvalRoomSources = [
      ...adjustments.map((item) => ({
        room: item.rentBill.contract.room,
        type: '账单调整',
      })),
      ...refunds.map((item) => ({
        room: item.contract.room,
        type: '退款申请',
      })),
      ...rebates.map((item) => ({
        room: item.contract.room,
        type: '固定月租退差',
      })),
    ];
    const approvalRoomsById = new Map<
      number,
      { roomId: number; fullHouseNo: string; types: string[]; count: number }
    >();
    for (const source of approvalRoomSources) {
      if (!source.room) continue;
      const current = approvalRoomsById.get(source.room.id) ?? {
        roomId: source.room.id,
        fullHouseNo: source.room.fullHouseNo,
        types: [],
        count: 0,
      };
      current.count += 1;
      if (!current.types.includes(source.type)) current.types.push(source.type);
      approvalRoomsById.set(source.room.id, current);
    }

    const result: Record<string, unknown> = {
      roomSummary: {
        total: rooms.length,
        operating: operating.length,
        rented: statusCounts.RENTED ?? 0,
        occupancyRate: operating.length
          ? new Prisma.Decimal(statusCounts.RENTED ?? 0)
              .div(operating.length)
              .mul(100)
              .toDecimalPlaces(2)
          : null,
        statusCounts,
        rooms: roomSummaries,
      },
      rentReminders: reminders,
      rentReminderDays,
      arrears,
      expiringContracts: expiring,
      contractExpiryDays,
      longVacancyRooms,
      longVacancyDays,
      monthlyMoveInCount,
      monthlyCheckoutCount,
      approvals: {
        billAdjustments: adjustments.length,
        paymentRefunds: refunds.length,
        pricingRebates: rebates.length,
      },
      approvalRooms: Array.from(approvalRoomsById.values()),
    };
    if (user.role === UserRole.SUPER_ADMIN) {
      result['arrearsTotal'] = arrears.reduce(
        (sum, item) => sum.plus(item.outstandingAmount),
        new Prisma.Decimal(0),
      );
      result['rentCollectionOverview'] = {
        period: monthPeriod,
        netReceivable: rentCollection!.total.netReceivable,
        validReceived: rentCollection!.total.validReceived,
        outstanding: rentCollection!.total.outstanding,
        collectionRate: rentCollection!.collectionRate,
      };
    }
    return result;
  }
}
