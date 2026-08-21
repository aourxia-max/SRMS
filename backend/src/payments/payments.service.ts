import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, RentBillStatus, UserRole } from '@prisma/client';
import { AuthUser } from '../auth/auth-user.type';
import { PrismaService } from '../prisma/prisma.service';
import { RecordPaymentDto } from './dto/record-payment.dto';
import { PaymentListQueryDto } from './dto/payment-list-query.dto';
import { EditPaymentDto } from './dto/edit-payment.dto';
import { chineseUppercaseMoney, receiptTypeFor } from './payment-presenter';
import { resolveAllocationPlan } from './payment-policy';

@Injectable()
export class PaymentsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: PaymentListQueryDto = {}, user?: AuthUser) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 10;
    const where: Prisma.PaymentWhereInput = {
      ...(query.contractId ? { contractId: query.contractId } : {}),
      ...(query.receiptNo ? { receiptNo: { contains: query.receiptNo } } : {}),
      ...(query.dateFrom || query.dateTo
        ? {
            paymentDate: {
              ...(query.dateFrom ? { gte: new Date(query.dateFrom) } : {}),
              ...(query.dateTo ? { lte: new Date(query.dateTo) } : {}),
            },
          }
        : {}),
      ...(query.roomKeyword || query.tenantKeyword
        ? {
            contract: {
              ...(query.roomKeyword
                ? {
                    room: {
                      fullHouseNo: { contains: query.roomKeyword },
                    },
                  }
                : {}),
              ...(query.tenantKeyword
                ? {
                    members: {
                      some: {
                        isCurrent: true,
                        tenant: { name: { contains: query.tenantKeyword } },
                      },
                    },
                  }
                : {}),
            },
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.db.payment.findMany({
        where,
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
          adjustments: true,
        },
        orderBy: { id: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.db.payment.count({ where }),
    ]);
    const items = rows.map((row) => {
      const tenant = row.contract.members[0]?.tenant;
      return {
        id: row.id,
        receiptNo: row.receiptNo,
        paymentDate: row.paymentDate,
        amount: this.money(row.amount),
        method: row.method,
        status: row.status,
        receiptType: receiptTypeFor(row.status, row.adjustments),
        contract: {
          id: row.contract.id,
          contractNo: row.contract.contractNo,
          room: row.contract.room,
        },
        tenant: tenant ? this.presentTenant(tenant, user?.role) : null,
      };
    });
    return { items, page, pageSize, total };
  }

  async detail(id: number, user: AuthUser) {
    const payment = await this.prisma.db.payment.findUnique({
      where: { id },
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
        allocations: {
          include: { rentBill: true },
          orderBy: { allocationOrder: 'asc' },
        },
        adjustments: { orderBy: { submittedAt: 'asc' } },
        prepaymentTransactions: { orderBy: { id: 'asc' } },
        paymentFiles: { include: { fileAsset: true } },
        refunds: { include: { allocations: true }, orderBy: { id: 'desc' } },
        voidRequests: { orderBy: { id: 'desc' } },
      },
    });
    if (!payment) throw new NotFoundException('收款记录不存在');

    const [operator, operationLogs] = await Promise.all([
      this.prisma.db.user.findUnique({
        where: { id: payment.operatorId },
        select: { id: true, displayName: true },
      }),
      this.prisma.db.operationLog.findMany({
        where: { entityType: 'PAYMENT', entityId: payment.id },
        orderBy: { occurredAt: 'desc' },
      }),
    ]);
    const tenant = payment.contract.members[0]?.tenant;
    const receiptType = receiptTypeFor(payment.status, payment.adjustments);
    const confirmedAdjustmentAmount = payment.adjustments
      .filter(
        (item) =>
          item.approvalStatus === 'APPROVED' &&
          item.direction === 'DECREASE' &&
          !item.reversedByAdjustmentId,
      )
      .reduce((sum, item) => sum.plus(item.amount), new Prisma.Decimal(0));
    const prepaymentAmount = payment.prepaymentTransactions.reduce(
      (sum, item) =>
        item.transactionType === 'CREDIT_RECEIPT'
          ? sum.plus(item.amount)
          : item.transactionType === 'REVERSAL'
            ? sum.minus(item.amount)
            : sum,
      new Prisma.Decimal(0),
    );
    const allocations = payment.allocations.map((item) => ({
      id: item.id,
      allocationOrder: item.allocationOrder,
      allocationType: item.allocationType,
      allocatedAmount: this.money(item.allocatedAmount),
      reversedAmount: this.money(item.reversedAmount),
      effectiveAmount: this.money(
        new Prisma.Decimal(item.allocatedAmount).minus(item.reversedAmount),
      ),
      bill: {
        ...item.rentBill,
        unitMonthlyRent: this.money(item.rentBill.unitMonthlyRent),
        baseRentAmount: this.money(item.rentBill.baseRentAmount),
        rentFreeAmount: this.money(item.rentBill.rentFreeAmount),
        discountAmount: this.money(item.rentBill.discountAmount),
        adjustmentAmount: this.money(item.rentBill.adjustmentAmount),
        payableAmount: this.money(item.rentBill.payableAmount),
        receivedAmount: this.money(item.rentBill.receivedAmount),
        outstandingAmount: this.money(item.rentBill.outstandingAmount),
      },
    }));
    const adjustments = payment.adjustments.map((item) => ({
      ...item,
      amount: this.money(item.amount),
      beforeAmount: this.money(item.beforeAmount),
      afterAmount: this.money(item.afterAmount),
    }));
    const prepayments = payment.prepaymentTransactions.map((item) => ({
      ...item,
      amount: this.money(item.amount),
      balanceAfter: this.money(item.balanceAfter),
    }));
    const files = payment.paymentFiles.map((item) => ({
      id: item.fileAsset.id,
      purpose: item.purpose,
      originalName: item.fileAsset.originalName,
      mimeType: item.fileAsset.mimeType,
      sizeBytes: item.fileAsset.sizeBytes.toString(),
      uploadedAt: item.fileAsset.uploadedAt,
    }));
    const activeAllocations = allocations.filter((item) =>
      new Prisma.Decimal(item.effectiveAmount).gt(0),
    );
    const activeBillIds = [
      ...new Set(activeAllocations.map((item) => item.bill.id)),
    ];
    const originalReceivable = activeBillIds.reduce((sum, billId) => {
      const originalAdjustment = payment.adjustments.find(
        (item) => item.rentBillId === billId && item.direction === 'DECREASE',
      );
      const bill = payment.allocations.find(
        (item) => item.rentBill.id === billId,
      )!.rentBill;
      return sum.plus(originalAdjustment?.beforeAmount ?? bill.payableAmount);
    }, new Prisma.Decimal(0));

    return {
      id: payment.id,
      receiptNo: payment.receiptNo,
      receiptType,
      contractId: payment.contractId,
      paymentCategory: payment.paymentCategory,
      paymentDate: payment.paymentDate,
      amount: this.money(payment.amount),
      method: payment.method,
      externalReference: payment.externalReference,
      status: payment.status,
      voidReason: payment.voidReason,
      voidedAt: payment.voidedAt,
      editReason: payment.editReason,
      remark: payment.remark,
      contract: {
        id: payment.contract.id,
        contractNo: payment.contract.contractNo,
        room: payment.contract.room,
      },
      tenant: tenant ? this.presentTenant(tenant, user.role) : null,
      operator,
      metrics: {
        receivedAmount: this.money(payment.amount),
        confirmedAdjustmentAmount: this.money(confirmedAdjustmentAmount),
        prepaymentAmount: this.money(prepaymentAmount),
        coveredBillCount: payment.allocations.length,
      },
      allocations,
      adjustments,
      prepayments,
      files,
      refunds: payment.refunds.map((item) => ({
        ...item,
        refundAmount: this.money(item.refundAmount),
        allocations: item.allocations.map((allocation) => ({
          ...allocation,
          reversedAmount: this.money(allocation.reversedAmount),
        })),
      })),
      voidRequests: payment.voidRequests,
      operationLogs,
      receipt: {
        type: receiptType,
        receiptNo: payment.receiptNo,
        originalReceivable: this.money(originalReceivable),
        confirmedAdjustmentAmount: this.money(confirmedAdjustmentAmount),
        actualPaid: this.money(payment.amount),
        amountUppercase: chineseUppercaseMoney(payment.amount),
        lines: activeAllocations.map((item) => ({
          allocationOrder: item.allocationOrder,
          billNo: item.bill.billNo,
          periodStart: item.bill.periodStart,
          periodEnd: item.bill.periodEnd,
          payableAmount: item.bill.payableAmount,
          allocatedAmount: item.allocatedAmount,
        })),
      },
    };
  }

  async receipt(id: number, user: AuthUser) {
    return (await this.detail(id, user)).receipt;
  }

  async edit(id: number, dto: EditPaymentDto, user: AuthUser) {
    if (user.role !== UserRole.SUPER_ADMIN)
      throw new ForbiddenException('只有超级管理员可以修改已确认收款');

    return this.prisma.db.$transaction(async (tx) => {
      const identity = await tx.payment.findUniqueOrThrow({
        where: { id },
        select: { contractId: true },
      });
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM contracts WHERE id = ${identity.contractId} FOR UPDATE`,
      );
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM payments WHERE id = ${id} FOR UPDATE`,
      );
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM payment_allocations WHERE payment_id = ${id} ORDER BY id FOR UPDATE`,
      );
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM rent_bills WHERE contract_id = ${identity.contractId} ORDER BY id FOR UPDATE`,
      );
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM prepayment_transactions WHERE contract_id = ${identity.contractId} ORDER BY id FOR UPDATE`,
      );
      const payment = await tx.payment.findUniqueOrThrow({
        where: { id },
        include: {
          allocations: { orderBy: { id: 'asc' } },
          prepaymentTransactions: { orderBy: { id: 'asc' } },
          refunds: true,
          voidRequests: true,
        },
      });
      if (['VOIDED', 'FULLY_REFUNDED'].includes(payment.status))
        throw new BadRequestException('已作废或已全额退款的收款不能修改');
      if (
        payment.refunds.some((item) =>
          ['PENDING', 'APPROVED'].includes(item.approvalStatus),
        )
      )
        throw new BadRequestException(
          '存在待处理或已确认退款，不能直接修改收款',
        );
      if (
        payment.voidRequests.some((item) => item.approvalStatus === 'PENDING')
      )
        throw new BadRequestException('存在待处理作废申请，不能直接修改收款');

      const amount = new Prisma.Decimal(dto.amount ?? payment.amount);
      if (!amount.isFinite() || amount.lte(0))
        throw new BadRequestException('收款金额必须大于零');

      const bills = await tx.rentBill.findMany({
        where: {
          contractId: payment.contractId,
          status: { notIn: ['VOIDED', 'REFUNDED'] },
        },
        orderBy: [{ dueDate: 'asc' }, { periodSeq: 'asc' }],
      });
      const restoredBills = bills.map((bill) => ({
        ...bill,
        receivedAmount: new Prisma.Decimal(bill.receivedAmount),
        outstandingAmount: new Prisma.Decimal(bill.outstandingAmount),
      }));
      const billById = new Map(restoredBills.map((bill) => [bill.id, bill]));
      const previousActiveBillIds: number[] = [];

      for (const allocation of payment.allocations) {
        const effectiveAmount = new Prisma.Decimal(
          allocation.allocatedAmount,
        ).minus(allocation.reversedAmount);
        if (effectiveAmount.lte(0)) continue;
        previousActiveBillIds.push(allocation.rentBillId);
        const bill = billById.get(allocation.rentBillId);
        if (!bill)
          throw new BadRequestException('原收款分配账单不存在，不能修改');
        bill.receivedAmount = Prisma.Decimal.max(
          0,
          bill.receivedAmount.minus(effectiveAmount),
        ).toDecimalPlaces(2);
        bill.outstandingAmount = new Prisma.Decimal(bill.payableAmount)
          .minus(bill.receivedAmount)
          .toDecimalPlaces(2);
        await tx.paymentAllocation.update({
          where: { id: allocation.id },
          data: {
            reversedAmount: new Prisma.Decimal(allocation.reversedAmount).plus(
              effectiveAmount,
            ),
          },
        });
        await tx.rentBill.update({
          where: { id: bill.id },
          data: {
            receivedAmount: bill.receivedAmount,
            outstandingAmount: bill.outstandingAmount,
            status: bill.receivedAmount.gt(0) ? 'PARTIAL' : 'PENDING',
          },
        });
      }

      const latestPrepayment = await tx.prepaymentTransaction.findFirst({
        where: { contractId: payment.contractId },
        orderBy: { id: 'desc' },
      });
      let prepaymentBalance = new Prisma.Decimal(
        latestPrepayment?.balanceAfter ?? 0,
      );
      const priorPrepayment = payment.prepaymentTransactions.reduce(
        (sum, item) =>
          item.transactionType === 'CREDIT_RECEIPT'
            ? sum.plus(item.amount)
            : item.transactionType === 'REVERSAL'
              ? sum.minus(item.amount)
              : sum,
        new Prisma.Decimal(0),
      );
      if (priorPrepayment.gt(0)) {
        if (prepaymentBalance.lt(priorPrepayment))
          throw new BadRequestException('预收款余额不足，不能修改该收款');
        prepaymentBalance = prepaymentBalance.minus(priorPrepayment);
        await tx.prepaymentTransaction.create({
          data: {
            contractId: payment.contractId,
            transactionNo: `YSREV${Date.now()}${payment.id}`,
            transactionType: 'REVERSAL',
            amount: priorPrepayment,
            balanceAfter: prepaymentBalance,
            paymentId: payment.id,
            reason: `修改收款 ${payment.receiptNo} 前逆转原预收款`,
          },
        });
      }

      const eligibleBills = restoredBills.filter((bill) =>
        bill.outstandingAmount.gt(0),
      );
      const selectedBillIds =
        dto.selectedBillIds ??
        (previousActiveBillIds.length ? previousActiveBillIds : undefined);
      const plan = resolveAllocationPlan(
        eligibleBills,
        amount.toFixed(2),
        selectedBillIds,
        user.role,
        dto.manualAllocationReason ?? dto.editReason,
      );

      if (plan.allocations.length) {
        await tx.paymentAllocation.createMany({
          data: plan.allocations.map((item) => ({
            paymentId: payment.id,
            rentBillId: item.rentBillId,
            allocatedAmount: item.amount,
            allocationOrder: item.allocationOrder,
            allocationType: item.allocationType,
          })),
        });
        for (const allocation of plan.allocations) {
          const bill = billById.get(allocation.rentBillId)!;
          bill.receivedAmount = bill.receivedAmount.plus(allocation.amount);
          bill.outstandingAmount = new Prisma.Decimal(bill.payableAmount)
            .minus(bill.receivedAmount)
            .toDecimalPlaces(2);
          await tx.rentBill.update({
            where: { id: bill.id },
            data: {
              receivedAmount: bill.receivedAmount,
              outstandingAmount: bill.outstandingAmount,
              status: bill.outstandingAmount.isZero() ? 'PAID' : 'PARTIAL',
            },
          });
        }
      }
      if (plan.prepaymentAmount.gt(0)) {
        prepaymentBalance = prepaymentBalance.plus(plan.prepaymentAmount);
        await tx.prepaymentTransaction.create({
          data: {
            contractId: payment.contractId,
            transactionNo: `YS${Date.now()}${payment.id}`,
            transactionType: 'CREDIT_RECEIPT',
            amount: plan.prepaymentAmount,
            balanceAfter: prepaymentBalance,
            paymentId: payment.id,
            reason: `修改收款 ${payment.receiptNo} 后的超额金额转入预收款`,
          },
        });
      }

      await tx.payment.update({
        where: { id: payment.id },
        data: {
          paymentDate: dto.paymentDate
            ? new Date(dto.paymentDate)
            : payment.paymentDate,
          amount,
          method: dto.method ?? payment.method,
          externalReference:
            dto.externalReference === undefined
              ? payment.externalReference
              : dto.externalReference,
          remark: dto.remark === undefined ? payment.remark : dto.remark,
          editReason: dto.editReason,
        },
      });
      const before = {
        paymentDate: payment.paymentDate.toISOString().slice(0, 10),
        amount: this.money(payment.amount),
        method: payment.method,
        externalReference: payment.externalReference,
        remark: payment.remark,
        selectedBillIds: previousActiveBillIds,
      };
      const after = {
        paymentDate: dto.paymentDate ?? before.paymentDate,
        amount: amount.toFixed(2),
        method: dto.method ?? payment.method,
        externalReference:
          dto.externalReference === undefined
            ? payment.externalReference
            : dto.externalReference,
        remark: dto.remark === undefined ? payment.remark : dto.remark,
        selectedBillIds: plan.allocations.map((item) => item.rentBillId),
      };
      await tx.securityAuditLog.create({
        data: {
          eventType: 'PAYMENT_CORRECTED',
          entityType: 'PAYMENT',
          entityId: payment.id,
          operatorId: user.id,
          reason: dto.editReason,
          eventData: { before, after },
        },
      });
      await tx.operationLog.create({
        data: {
          module: 'PAYMENTS',
          action: 'PAYMENT_CORRECTED',
          entityType: 'PAYMENT',
          entityId: payment.id,
          entityNo: payment.receiptNo,
          summary: `修改收款 ${payment.receiptNo}`,
          beforeData: before,
          afterData: after,
          reason: dto.editReason,
          operatorId: user.id,
          operatorRole: user.role,
        },
      });
      await this.refreshContractPaymentSnapshot(tx, payment.contractId);
      return { id: payment.id, receiptNo: payment.receiptNo };
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
    if (user.role !== UserRole.SUPER_ADMIN && user.role !== UserRole.ADMIN)
      throw new ForbiddenException('当前角色不能登记收款');
    const amount = new Prisma.Decimal(dto.amount);
    if (!amount.isFinite() || amount.lte(0))
      throw new BadRequestException('收款金额必须大于零');
    if (
      dto.proofFileIds &&
      new Set(dto.proofFileIds).size !== dto.proofFileIds.length
    )
      throw new BadRequestException('收款凭证不能重复');
    return this.prisma.db.$transaction(async (tx) => {
      const contract = await tx.contract.findUniqueOrThrow({
        where: { id: dto.contractId },
      });
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM contracts WHERE id = ${contract.id} FOR UPDATE`,
      );
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM rent_bills WHERE contract_id = ${contract.id} ORDER BY id FOR UPDATE`,
      );
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM prepayment_transactions WHERE contract_id = ${contract.id} ORDER BY id FOR UPDATE`,
      );
      const eligibleBills = await tx.rentBill.findMany({
        where: {
          contractId: dto.contractId,
          status: { notIn: ['VOIDED', 'REFUNDED'] },
          outstandingAmount: { gt: 0 },
        },
        orderBy: [{ dueDate: 'asc' }, { periodSeq: 'asc' }],
      });
      const plan = resolveAllocationPlan(
        eligibleBills,
        amount.toFixed(2),
        dto.selectedBillIds,
        user.role,
        dto.manualAllocationReason,
      );

      const proofFileIds = dto.proofFileIds ?? [];
      if (proofFileIds.length) {
        const proofFiles = await tx.fileAsset.findMany({
          where: {
            id: { in: proofFileIds },
            category: 'PAYMENT_PROOF',
            uploadedBy: user.id,
            lockedAt: null,
          },
        });
        if (proofFiles.length !== proofFileIds.length)
          throw new BadRequestException(
            '收款凭证不存在、已被使用或不属于当前操作人',
          );
      }

      const selectedBillIds = new Set(
        plan.allocations.map((item) => item.rentBillId),
      );
      const allocatedByBill = new Map(
        plan.allocations.map((item) => [item.rentBillId, item.amount]),
      );
      for (const adjustment of dto.adjustments ?? []) {
        const bill = eligibleBills.find(
          (item) => item.id === adjustment.rentBillId,
        );
        if (!bill || !selectedBillIds.has(adjustment.rentBillId))
          throw new BadRequestException('优惠必须归属于本次覆盖的账单');
        const adjustmentAmount = new Prisma.Decimal(adjustment.amount);
        const remainingAfterPayment = new Prisma.Decimal(
          bill.outstandingAmount,
        ).minus(allocatedByBill.get(bill.id) ?? 0);
        if (
          !adjustmentAmount.isFinite() ||
          adjustmentAmount.lte(0) ||
          adjustmentAmount.gt(remainingAfterPayment)
        )
          throw new BadRequestException(
            '优惠金额不能超过该账单本次收款后的未收金额',
          );
      }

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
      if (plan.allocations.length) {
        await tx.paymentAllocation.createMany({
          data: plan.allocations.map((item) => ({
            paymentId: payment.id,
            rentBillId: item.rentBillId,
            allocatedAmount: item.amount,
            allocationOrder: item.allocationOrder,
            allocationType: item.allocationType,
          })),
        });
        for (const allocation of plan.allocations) {
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
      if (plan.prepaymentAmount.gt(0)) {
        const latest = await tx.prepaymentTransaction.findFirst({
          where: { contractId: contract.id },
          orderBy: { id: 'desc' },
        });
        const balanceAfter = new Prisma.Decimal(latest?.balanceAfter ?? 0)
          .plus(plan.prepaymentAmount)
          .toDecimalPlaces(2);
        await tx.prepaymentTransaction.create({
          data: {
            contractId: contract.id,
            transactionNo: `YS${Date.now()}${payment.id}`,
            transactionType: 'CREDIT_RECEIPT',
            amount: plan.prepaymentAmount,
            balanceAfter,
            paymentId: payment.id,
            reason: '租金收款超出选定账单应收，转入预收款',
          },
        });
      }

      const adjustmentIds: number[] = [];
      for (const adjustment of dto.adjustments ?? []) {
        const bill = eligibleBills.find(
          (item) => item.id === adjustment.rentBillId,
        )!;
        const created = await tx.billAdjustment.create({
          data: {
            adjustmentNo: `TZ${Date.now()}${adjustment.rentBillId}`,
            rentBillId: adjustment.rentBillId,
            adjustmentType: adjustment.adjustmentType,
            direction: 'DECREASE',
            amount: new Prisma.Decimal(adjustment.amount),
            beforeAmount: bill.payableAmount,
            afterAmount: Prisma.Decimal.max(
              0,
              new Prisma.Decimal(bill.payableAmount).minus(adjustment.amount),
            ).toDecimalPlaces(2),
            reason: adjustment.reason,
            sourcePaymentId: payment.id,
            approvalStatus: 'PENDING',
            submittedBy: user.id,
          },
        });
        adjustmentIds.push(created.id);
      }

      if (proofFileIds.length) {
        const lockedAt = new Date();
        await tx.paymentFile.createMany({
          data: proofFileIds.map((fileAssetId) => ({
            paymentId: payment.id,
            fileAssetId,
            purpose: 'PAYMENT_PROOF',
            uploadedBy: user.id,
            lockedAt,
          })),
        });
        await tx.fileAsset.updateMany({
          where: { id: { in: proofFileIds }, lockedAt: null },
          data: { lockedAt },
        });
      }

      if (plan.manualOverride) {
        await tx.securityAuditLog.create({
          data: {
            eventType: 'PAYMENT_ALLOCATION_OVERRIDDEN',
            entityType: 'PAYMENT',
            entityId: payment.id,
            operatorId: user.id,
            reason: dto.manualAllocationReason,
            eventData: {
              automaticBillIds: eligibleBills
                .slice(0, dto.selectedBillIds?.length ?? eligibleBills.length)
                .map((bill) => bill.id),
              selectedBillIds: dto.selectedBillIds ?? [],
            },
          },
        });
      }

      await tx.operationLog.create({
        data: {
          module: 'PAYMENTS',
          action: 'PAYMENT_RECORDED',
          entityType: 'PAYMENT',
          entityId: payment.id,
          entityNo: payment.receiptNo,
          summary: `登记收款 ${payment.receiptNo}`,
          afterData: {
            amount: amount.toFixed(2),
            billIds: plan.allocations.map((item) => item.rentBillId),
            adjustmentIds,
            proofFileIds,
          },
          operatorId: user.id,
          operatorRole: user.role,
        },
      });
      await this.refreshContractPaymentSnapshot(tx, contract.id);
      return {
        id: payment.id,
        receiptNo: payment.receiptNo,
        receiptType: adjustmentIds.length ? 'PROVISIONAL' : 'FORMAL',
        adjustmentIds,
      } as const;
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

  private money(value: Prisma.Decimal.Value) {
    return new Prisma.Decimal(value).toDecimalPlaces(2).toFixed(2);
  }

  private presentTenant(
    tenant: { id: number; name: string; phone: string | null },
    role?: UserRole,
  ) {
    if (role !== UserRole.VISITOR) return tenant;
    return {
      id: tenant.id,
      name: tenant.name ? `${tenant.name.slice(0, 1)}*` : '',
      phone: tenant.phone
        ? `${tenant.phone.slice(0, 3)}****${tenant.phone.slice(-4)}`
        : null,
    };
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
