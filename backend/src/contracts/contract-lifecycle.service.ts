import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';

type LifecycleResult = { activated: number; pendingCheckout: number };

@Injectable()
export class ContractLifecycleService implements OnApplicationBootstrap {
  constructor(private readonly prisma: PrismaService) {}

  async onApplicationBootstrap() {
    await this.run();
  }

  @Cron('0 5 0 * * *')
  async run(now = new Date()): Promise<LifecycleResult> {
    const day = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );
    const pending = await this.prisma.db.contract.findMany({
      where: { status: 'PENDING_START', startDate: { lte: day } },
      select: { id: true, contractNo: true, roomId: true },
    });
    const active = await this.prisma.db.contract.findMany({
      where: { status: 'ACTIVE', endDate: { lte: day } },
      select: { id: true, contractNo: true, roomId: true },
    });

    let activated = 0;
    let pendingCheckout = 0;
    for (const contract of pending) {
      if (await this.activate(contract, now)) activated += 1;
    }
    for (const contract of active) {
      if (await this.beginCheckout(contract, now)) pendingCheckout += 1;
    }
    return { activated, pendingCheckout };
  }

  private async activate(
    contract: { id: number; contractNo: string; roomId: number },
    now: Date,
  ) {
    return this.prisma.db.$transaction(async (tx) => {
      const changed = await tx.contract.updateMany({
        where: { id: contract.id, status: 'PENDING_START' },
        data: { status: 'ACTIVE', activatedAt: now },
      });
      if (changed.count !== 1) return false;
      const roomChanged = await tx.room.updateMany({
        where: { id: contract.roomId, roomStatus: 'PENDING_MOVE_IN' },
        data: { roomStatus: 'RENTED', statusChangedAt: now },
      });
      if (roomChanged.count === 1) {
        await tx.roomStatusHistory.create({
          data: {
            roomId: contract.roomId,
            fromStatus: 'PENDING_MOVE_IN',
            toStatus: 'RENTED',
            changeReason: `合同自动生效：${contract.contractNo}`,
            businessType: 'CONTRACT',
            businessId: contract.id,
          },
        });
      }
      return true;
    });
  }

  private async beginCheckout(
    contract: { id: number; contractNo: string; roomId: number },
    now: Date,
  ) {
    return this.prisma.db.$transaction(async (tx) => {
      const changed = await tx.contract.updateMany({
        where: { id: contract.id, status: 'ACTIVE' },
        data: { status: 'PENDING_CHECKOUT' },
      });
      if (changed.count !== 1) return false;
      const roomChanged = await tx.room.updateMany({
        where: { id: contract.roomId, roomStatus: 'RENTED' },
        data: { roomStatus: 'PENDING_CHECKOUT', statusChangedAt: now },
      });
      if (roomChanged.count === 1) {
        await tx.roomStatusHistory.create({
          data: {
            roomId: contract.roomId,
            fromStatus: 'RENTED',
            toStatus: 'PENDING_CHECKOUT',
            changeReason: `合同到期待退房：${contract.contractNo}`,
            businessType: 'CONTRACT',
            businessId: contract.id,
          },
        });
      }
      return true;
    });
  }
}
