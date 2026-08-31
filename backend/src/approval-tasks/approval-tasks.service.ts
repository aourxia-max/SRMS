import { Injectable } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import type { AuthUser } from '../auth/auth-user.type';
import { PrismaService } from '../prisma/prisma.service';
import {
  emptyApprovalTaskCounts,
  type ApprovalTaskCounts,
} from './approval-task-counts';

@Injectable()
export class ApprovalTasksService {
  constructor(private readonly prisma: PrismaService) {}

  async counts(user: AuthUser): Promise<ApprovalTaskCounts> {
    if (user.role === UserRole.VISITOR) return emptyApprovalTaskCounts();

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
