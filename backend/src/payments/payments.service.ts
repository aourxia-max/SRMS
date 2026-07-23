import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma, RentBillStatus } from '@prisma/client';
import { AuthUser } from '../auth/auth-user.type';
import { PrismaService } from '../prisma/prisma.service';
import { RecordPaymentDto } from './dto/record-payment.dto';
import { allocatePayment } from './payment-allocation';

@Injectable()
export class PaymentsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(contractId?: number) {
    return this.prisma.db.payment.findMany({
      where: contractId ? { contractId } : undefined,
      include: { allocations: { include: { rentBill: true } }, contract: true },
      orderBy: { id: 'desc' },
    });
  }

  async prepayments(contractId: number) {
    const items = await this.prisma.db.prepaymentTransaction.findMany({
      where: { contractId },
      orderBy: { id: 'desc' },
    });
    return { balance: items[0]?.balanceAfter ?? new Prisma.Decimal(0), items };
  }

  async record(dto: RecordPaymentDto, user: AuthUser) {
    const amount = new Prisma.Decimal(dto.amount);
    if (!amount.isFinite() || amount.lte(0))
      throw new BadRequestException('收款金额必须大于零');
    if (
      dto.selectedBillIds &&
      new Set(dto.selectedBillIds).size !== dto.selectedBillIds.length
    )
      throw new BadRequestException('选中的账单不能重复');
    return this.prisma.db.$transaction(async (tx) => {
      const contract = await tx.contract.findUniqueOrThrow({
        where: { id: dto.contractId },
      });
      const eligibleBills = await tx.rentBill.findMany({
        where: {
          contractId: dto.contractId,
          status: { notIn: ['VOIDED', 'REFUNDED'] },
          outstandingAmount: { gt: 0 },
          ...(dto.selectedBillIds?.length
            ? { id: { in: dto.selectedBillIds } }
            : {}),
        },
        orderBy: [{ dueDate: 'asc' }, { periodSeq: 'asc' }],
      });
      if (
        dto.selectedBillIds?.length &&
        eligibleBills.length !== dto.selectedBillIds.length
      )
        throw new BadRequestException('所选账单不存在、已作废或不属于该合同');
      const { allocations, prepaymentAmount } = allocatePayment(
        amount,
        eligibleBills,
      );
      const payment = await tx.payment.create({
        data: {
          receiptNo: await this.receiptNo(tx),
          contractId: contract.id,
          paymentCategory: 'RENT',
          paymentDate: new Date(dto.paymentDate),
          amount,
          method: dto.method,
          externalReference: dto.externalReference,
          remark: dto.remark,
          operatorId: user.id,
        },
      });
      if (allocations.length) {
        await tx.paymentAllocation.createMany({
          data: allocations.map((item) => ({
            paymentId: payment.id,
            rentBillId: item.rentBillId,
            allocatedAmount: item.amount,
          })),
        });
        for (const allocation of allocations) {
          const bill = eligibleBills.find(
            (item) => item.id === allocation.rentBillId,
          )!;
          const receivedAmount = new Prisma.Decimal(bill.receivedAmount)
            .plus(allocation.amount)
            .toDecimalPlaces(2);
          const outstandingAmount = new Prisma.Decimal(bill.payableAmount)
            .minus(receivedAmount)
            .toDecimalPlaces(2);
          const status: RentBillStatus = outstandingAmount.isZero()
            ? 'PAID'
            : 'PARTIAL';
          await tx.rentBill.update({
            where: { id: bill.id },
            data: { receivedAmount, outstandingAmount, status },
          });
        }
      }
      if (prepaymentAmount.gt(0)) {
        const latest = await tx.prepaymentTransaction.findFirst({
          where: { contractId: contract.id },
          orderBy: { id: 'desc' },
        });
        const balanceAfter = new Prisma.Decimal(latest?.balanceAfter ?? 0)
          .plus(prepaymentAmount)
          .toDecimalPlaces(2);
        await tx.prepaymentTransaction.create({
          data: {
            contractId: contract.id,
            transactionNo: `YS${Date.now()}${payment.id}`,
            transactionType: 'CREDIT_RECEIPT',
            amount: prepaymentAmount,
            balanceAfter,
            paymentId: payment.id,
            reason: '租金收款超出选定账单应收，转入预收款',
          },
        });
      }
      await this.refreshContractPaymentSnapshot(tx, contract.id);
      return tx.payment.findUniqueOrThrow({
        where: { id: payment.id },
        include: { allocations: true, prepaymentTransactions: true },
      });
    });
  }

  private async refreshContractPaymentSnapshot(
    tx: Prisma.TransactionClient,
    contractId: number,
  ) {
    const bills = await tx.rentBill.findMany({
      where: { contractId },
      orderBy: { periodSeq: 'asc' },
    });
    let paidThroughDate: Date | null = null;
    let nextDueDate: Date | null = null;
    for (const bill of bills) {
      if (bill.status === 'VOIDED') continue;
      if (new Prisma.Decimal(bill.outstandingAmount).isZero())
        paidThroughDate = bill.periodEnd;
      else {
        nextDueDate = bill.dueDate;
        break;
      }
    }
    const contract = await tx.contract.findUniqueOrThrow({
      where: { id: contractId },
      include: { pricingTiers: { orderBy: { thresholdMonths: 'asc' } } },
    });
    const now = new Date();
    let qualifiedMonths =
      (now.getUTCFullYear() - contract.startDate.getUTCFullYear()) * 12 +
      now.getUTCMonth() -
      contract.startDate.getUTCMonth();
    if (now.getUTCDate() < contract.startDate.getUTCDate())
      qualifiedMonths -= 1;
    qualifiedMonths = Math.max(0, qualifiedMonths);
    const tierIsQualified = (tier: (typeof contract.pricingTiers)[number]) => {
      if (qualifiedMonths < tier.thresholdMonths) return false;
      if (!tier.requiresFullyPaid) return true;
      const cutoff = new Date(contract.startDate);
      cutoff.setUTCMonth(cutoff.getUTCMonth() + tier.thresholdMonths);
      return bills
        .filter(
          (bill) =>
            bill.periodEnd < cutoff &&
            !['VOIDED', 'REFUNDED'].includes(bill.status),
        )
        .every((bill) => bill.status === 'PAID');
    };
    const currentTier = contract.pricingTiers.filter(tierIsQualified).at(-1);
    const nextTier = contract.pricingTiers.find(
      (tier) => !tierIsQualified(tier),
    );
    await tx.contract.update({
      where: { id: contractId },
      data: {
        paidThroughDate,
        nextDueDate,
        qualifiedMonths,
        currentPricingTierId: currentTier?.id ?? null,
        nextTierDate: nextTier
          ? new Date(
              Date.UTC(
                contract.startDate.getUTCFullYear(),
                contract.startDate.getUTCMonth() + nextTier.thresholdMonths,
                contract.startDate.getUTCDate(),
              ),
            )
          : null,
      },
    });
  }

  private async receiptNo(tx: Prisma.TransactionClient) {
    const setting = await tx.systemSetting.findUnique({
      where: { settingKey: 'receiptPrefix' },
    });
    const configuredPrefix =
      setting && typeof setting.settingValue === 'string'
        ? setting.settingValue.trim()
        : '';
    const prefix = configuredPrefix || 'SK';
    return `${prefix}${Date.now()}${Math.floor(Math.random() * 1000)
      .toString()
      .padStart(3, '0')}`;
  }
}
