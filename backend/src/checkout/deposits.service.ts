import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthUser } from '../auth/auth-user.type';
import { PrismaService } from '../prisma/prisma.service';
import { RecordDepositDto } from './dto/record-deposit.dto';

@Injectable()
export class DepositsService {
  constructor(private readonly prisma: PrismaService) {}
  async list(contractId: number) {
    const items = await this.prisma.db.depositTransaction.findMany({
      where: { contractId },
      orderBy: { id: 'desc' },
    });
    return { balance: items[0]?.balanceAfter ?? new Prisma.Decimal(0), items };
  }
  async record(dto: RecordDepositDto, user: AuthUser) {
    const amount = new Prisma.Decimal(dto.amount);
    if (!amount.isFinite() || amount.lte(0))
      throw new BadRequestException('押金收取金额必须大于零');
    return this.prisma.db.$transaction(async (tx) => {
      const contract = await tx.contract.findUniqueOrThrow({
        where: { id: dto.contractId },
      });
      if (!['PENDING_START', 'ACTIVE'].includes(contract.status))
        throw new BadRequestException('当前合同不能登记押金收取');
      const latest = await tx.depositTransaction.findFirst({
        where: { contractId: contract.id },
        orderBy: { id: 'desc' },
      });
      const balanceAfter = new Prisma.Decimal(latest?.balanceAfter ?? 0)
        .plus(amount)
        .toDecimalPlaces(2);
      const setting = await tx.systemSetting.findUnique({
        where: { settingKey: 'receiptPrefix' },
      });
      const configuredPrefix =
        setting && typeof setting.settingValue === 'string'
          ? setting.settingValue.trim()
          : '';
      const payment = await tx.payment.create({
        data: {
          receiptNo: `${configuredPrefix || 'SK'}YJ${Date.now()}${contract.id}`,
          contractId: contract.id,
          paymentCategory: 'DEPOSIT',
          paymentDate: new Date(dto.paymentDate),
          amount,
          method: dto.method,
          externalReference: dto.externalReference,
          remark: dto.remark,
          operatorId: user.id,
        },
      });
      await tx.depositTransaction.create({
        data: {
          contractId: contract.id,
          transactionNo: `YJ${Date.now()}${payment.id}`,
          transactionType: 'RECEIPT',
          amount,
          balanceAfter,
          paymentId: payment.id,
          reason: '押金收取',
        },
      });
      return payment;
    });
  }
}
