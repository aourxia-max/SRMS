import { Injectable } from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import type { AuthUser } from '../auth/auth-user.type';
import { PrismaService } from '../prisma/prisma.service';
@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}
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
    const rooms = await this.prisma.db.room.findMany({
      where: {
        deletedAt: null,
        ...(buildingId ? { buildingId } : {}),
        ...(statuses?.length
          ? { roomStatus: { in: statuses as never[] } }
          : {}),
      },
      include: { building: true },
      orderBy: [{ buildingId: 'asc' }, { floorNo: 'asc' }, { houseNo: 'asc' }],
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
    ] = await Promise.all([
      this.prisma.db.rentBill.findMany({
        where: {
          dueDate: { gte: now, lte: in7 },
          outstandingAmount: { gt: 0 },
          status: { notIn: ['VOIDED', 'REFUNDED'] },
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
          dueDate: { lt: now },
          outstandingAmount: { gt: 0 },
          status: { notIn: ['VOIDED', 'REFUNDED'] },
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
      this.prisma.db.billAdjustment.count({
        where: { approvalStatus: 'PENDING' },
      }),
      this.prisma.db.paymentRefund.count({
        where: { approvalStatus: 'PENDING' },
      }),
      this.prisma.db.pricingRebate.count({
        where: { approvalStatus: 'PENDING' },
      }),
    ]);
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
        rooms,
      },
      rentReminders: reminders,
      rentReminderDays,
      arrears,
      expiringContracts: expiring,
      contractExpiryDays,
      longVacancyRooms,
      longVacancyDays,
      approvals: {
        billAdjustments: adjustments,
        paymentRefunds: refunds,
        pricingRebates: rebates,
      },
    };
    if (user.role === UserRole.SUPER_ADMIN)
      result['arrearsTotal'] = arrears.reduce(
        (sum, item) => sum.plus(item.outstandingAmount),
        new Prisma.Decimal(0),
      );
    return result;
  }
}
