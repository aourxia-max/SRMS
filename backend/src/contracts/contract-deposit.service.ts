import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { contractBusinessDay } from './contract-business-day';

type InitialContractDepositInput = {
  contractId: number;
  amount: Prisma.Decimal.Value;
  operatorId: number;
  occurredAt: Date;
};

function identifier(prefix: string, contractId: number) {
  return `${prefix}${contractId.toString().padStart(10, '0')}`;
}

@Injectable()
export class ContractDepositService {
  async recordInitialDeposit(
    tx: Prisma.TransactionClient,
    input: InitialContractDepositInput,
  ): Promise<void> {
    const amount = new Prisma.Decimal(input.amount).toDecimalPlaces(2);
    if (!amount.isFinite() || amount.isNegative()) {
      throw new BadRequestException('押金不得为负数');
    }
    if (amount.isZero()) return;

    const autoSourceKey = `CONTRACT_INITIAL_DEPOSIT:${input.contractId}`;
    const existing = await tx.payment.findUnique({
      where: { autoSourceKey },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException('该合同押金已自动入账，请勿重复提交');
    }

    let payment: { id: number };
    try {
      payment = await tx.payment.create({
        data: {
          receiptNo: identifier('SKYJHT', input.contractId),
          contractId: input.contractId,
          paymentCategory: 'DEPOSIT',
          paymentDate: contractBusinessDay(input.occurredAt),
          amount,
          method: 'SYSTEM_AUTO',
          autoSourceKey,
          operatorId: input.operatorId,
          status: 'CONFIRMED',
          remark: '合同押金自动确认到账',
        },
      });
    } catch (error) {
      if ((error as { code?: unknown })?.code === 'P2002') {
        throw new ConflictException('该合同押金已自动入账，请勿重复提交');
      }
      throw error;
    }

    await tx.depositTransaction.create({
      data: {
        contractId: input.contractId,
        transactionNo: identifier('YJHT', input.contractId),
        transactionType: 'RECEIPT',
        amount,
        balanceAfter: amount,
        paymentId: payment.id,
        reason: '合同押金自动确认到账',
        occurredAt: input.occurredAt,
      },
    });
  }
}
