import { Injectable } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import type { AuthUser } from '../auth/auth-user.type';
import { PrismaService } from '../prisma/prisma.service';
import {
  emptyApprovalTaskCounts,
  type ApprovalTaskCounts,
} from './approval-task-counts';
import {
  emptyApprovalTaskSummary,
  type ApprovalTaskItem,
  type ApprovalTaskSummary,
  type ApprovalTaskType,
} from './approval-task-summary';

@Injectable()
export class ApprovalTasksService {
  constructor(private readonly prisma: PrismaService) {}

  async summary(user: AuthUser): Promise<ApprovalTaskSummary> {
    if (user.role !== UserRole.SUPER_ADMIN) return emptyApprovalTaskSummary();

    const contractSelect = {
      id: true,
      contractNo: true,
      room: { select: { id: true, fullHouseNo: true } },
    } as const;
    const [
      contractChanges,
      pricingRebates,
      contractVoidRequests,
      billAdjustments,
      paymentRefunds,
      paymentVoidRequests,
      checkoutSettlements,
      depositRefunds,
    ] = await Promise.all([
      this.prisma.db.contractChange.findMany({
        where: { approvalStatus: 'PENDING' },
        select: {
          id: true,
          changeNo: true,
          submittedAt: true,
          contract: { select: contractSelect },
        },
      }),
      this.prisma.db.pricingRebate.findMany({
        where: { approvalStatus: 'PENDING' },
        select: {
          id: true,
          rebateNo: true,
          submittedAt: true,
          contract: { select: contractSelect },
        },
      }),
      this.prisma.db.contractVoidRequest.findMany({
        where: { status: 'PENDING' },
        select: {
          id: true,
          requestNo: true,
          submittedAt: true,
          contract: { select: contractSelect },
        },
      }),
      this.prisma.db.billAdjustment.findMany({
        where: { approvalStatus: 'PENDING' },
        select: {
          id: true,
          adjustmentNo: true,
          submittedAt: true,
          rentBill: {
            select: { contract: { select: contractSelect } },
          },
        },
      }),
      this.prisma.db.paymentRefund.findMany({
        where: { approvalStatus: 'PENDING' },
        select: {
          id: true,
          refundNo: true,
          submittedAt: true,
          contract: { select: contractSelect },
        },
      }),
      this.prisma.db.paymentVoidRequest.findMany({
        where: { approvalStatus: 'PENDING' },
        select: {
          id: true,
          requestNo: true,
          submittedAt: true,
          payment: {
            select: { contract: { select: contractSelect } },
          },
        },
      }),
      this.prisma.db.checkoutSettlement.findMany({
        where: { status: 'PENDING' },
        select: {
          id: true,
          settlementNo: true,
          submittedAt: true,
          contract: { select: contractSelect },
        },
      }),
      this.prisma.db.depositRefund.findMany({
        where: { approvalStatus: 'PENDING' },
        select: {
          id: true,
          refundNo: true,
          submittedAt: true,
          contract: { select: contractSelect },
        },
      }),
    ]);
    type ContractSummary = {
      id: number;
      contractNo: string;
      room: { id: number; fullHouseNo: string };
    };
    const toItem = (
      id: number,
      type: ApprovalTaskType,
      label: string,
      businessNo: string,
      submittedAt: Date | null,
      contract: ContractSummary,
    ): ApprovalTaskItem => ({
      id,
      type,
      label,
      businessNo,
      contractId: contract.id,
      contractNo: contract.contractNo,
      roomId: contract.room.id,
      fullHouseNo: contract.room.fullHouseNo,
      submittedAt,
    });
    const items = [
      ...contractChanges.map((item) =>
        toItem(
          item.id,
          'CONTRACT_CHANGE',
          '合同变更',
          item.changeNo,
          item.submittedAt,
          item.contract,
        ),
      ),
      ...pricingRebates.map((item) =>
        toItem(
          item.id,
          'PRICING_REBATE',
          '固定月租退差',
          item.rebateNo,
          item.submittedAt,
          item.contract,
        ),
      ),
      ...contractVoidRequests.map((item) =>
        toItem(
          item.id,
          'CONTRACT_VOID_REQUEST',
          '合同作废/纠错',
          item.requestNo,
          item.submittedAt,
          item.contract,
        ),
      ),
      ...billAdjustments.map((item) =>
        toItem(
          item.id,
          'BILL_ADJUSTMENT',
          '账单调整',
          item.adjustmentNo,
          item.submittedAt,
          item.rentBill.contract,
        ),
      ),
      ...paymentRefunds.map((item) =>
        toItem(
          item.id,
          'PAYMENT_REFUND',
          '退款申请',
          item.refundNo,
          item.submittedAt,
          item.contract,
        ),
      ),
      ...paymentVoidRequests.map((item) =>
        toItem(
          item.id,
          'PAYMENT_VOID_REQUEST',
          '收款作废',
          item.requestNo,
          item.submittedAt,
          item.payment.contract,
        ),
      ),
      ...checkoutSettlements.map((item) =>
        toItem(
          item.id,
          'CHECKOUT_SETTLEMENT',
          '退租结算',
          item.settlementNo,
          item.submittedAt,
          item.contract,
        ),
      ),
      ...depositRefunds.map((item) =>
        toItem(
          item.id,
          'DEPOSIT_REFUND',
          '押金退款',
          item.refundNo,
          item.submittedAt,
          item.contract,
        ),
      ),
    ].sort(
      (left, right) =>
        (right.submittedAt?.getTime() ?? 0) -
        (left.submittedAt?.getTime() ?? 0),
    );
    const contractsTotal =
      contractChanges.length +
      pricingRebates.length +
      contractVoidRequests.length;
    const paymentsTotal =
      billAdjustments.length +
      paymentRefunds.length +
      paymentVoidRequests.length;
    const checkoutsTotal = checkoutSettlements.length + depositRefunds.length;
    return {
      counts: {
        contractChanges: contractChanges.length,
        fixedRentRebates: pricingRebates.length,
        contractVoidRequests: contractVoidRequests.length,
        billAdjustments: billAdjustments.length,
        paymentRefunds: paymentRefunds.length,
        paymentVoidRequests: paymentVoidRequests.length,
        checkoutSettlements: checkoutSettlements.length,
        depositRefunds: depositRefunds.length,
        contractsTotal,
        paymentsTotal,
        checkoutsTotal,
        total: contractsTotal + paymentsTotal + checkoutsTotal,
      },
      items,
    };
  }

  async counts(user: AuthUser): Promise<ApprovalTaskCounts> {
    if (user.role !== UserRole.SUPER_ADMIN) return emptyApprovalTaskCounts();

    const [
      contractChanges,
      fixedRentRebates,
      contractVoidRequests,
      billAdjustments,
      paymentRefunds,
      paymentVoidRequests,
      checkoutSettlements,
      depositRefunds,
    ] = await Promise.all([
      this.prisma.db.contractChange.count({
        where: { approvalStatus: 'PENDING' },
      }),
      this.prisma.db.pricingRebate.count({
        where: { approvalStatus: 'PENDING' },
      }),
      this.prisma.db.contractVoidRequest.count({
        where: { status: 'PENDING' },
      }),
      this.prisma.db.billAdjustment.count({
        where: { approvalStatus: 'PENDING' },
      }),
      this.prisma.db.paymentRefund.count({
        where: { approvalStatus: 'PENDING' },
      }),
      this.prisma.db.paymentVoidRequest.count({
        where: { approvalStatus: 'PENDING' },
      }),
      this.prisma.db.checkoutSettlement.count({
        where: { status: 'PENDING' },
      }),
      this.prisma.db.depositRefund.count({
        where: { approvalStatus: 'PENDING' },
      }),
    ]);

    const contractsTotal =
      contractChanges + fixedRentRebates + contractVoidRequests;
    const paymentsTotal =
      billAdjustments + paymentRefunds + paymentVoidRequests;
    const checkoutsTotal = checkoutSettlements + depositRefunds;

    return {
      contractChanges,
      fixedRentRebates,
      contractVoidRequests,
      billAdjustments,
      paymentRefunds,
      paymentVoidRequests,
      checkoutSettlements,
      depositRefunds,
      contractsTotal,
      paymentsTotal,
      checkoutsTotal,
      total: contractsTotal + paymentsTotal + checkoutsTotal,
    };
  }
}
