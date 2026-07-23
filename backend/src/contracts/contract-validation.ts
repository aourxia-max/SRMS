import { BadRequestException, ConflictException } from '@nestjs/common';
import { RoomStatus } from '@prisma/client';
import { PricingTierDto } from './dto/pricing-tier.dto';
import { ConcessionDto } from './dto/concession.dto';

export function assertContractDates(
  startDate: Date,
  endDate: Date,
  paymentCycleMonths: number,
) {
  if (endDate < startDate)
    throw new BadRequestException('合同结束日期不能早于开始日期');
  if (
    !Number.isInteger(paymentCycleMonths) ||
    paymentCycleMonths < 1 ||
    paymentCycleMonths > 12
  )
    throw new BadRequestException('租缴周期必须为1至12个月');
}

export function assertContractRoomStatus(status: RoomStatus) {
  const unavailable: RoomStatus[] = [
    RoomStatus.SOLD,
    RoomStatus.FOR_SALE,
    RoomStatus.DISABLED,
  ];
  if (unavailable.includes(status))
    throw new ConflictException('该房源当前状态不能创建合同');
}

export function assertPrimaryTenant(
  tenantIds: number[],
  primaryTenantId: number,
) {
  if (!tenantIds.includes(primaryTenantId))
    throw new BadRequestException('主承租人必须属于合同成员');
  if (new Set(tenantIds).size !== tenantIds.length)
    throw new BadRequestException('合同成员不能重复');
}

export function assertPricingTiers(tiers: PricingTierDto[]) {
  if (!tiers.length)
    throw new BadRequestException('阶梯合同至少需要一个价格档位');
  const thresholds = tiers.map((tier) => tier.thresholdMonths);
  if (new Set(thresholds).size !== thresholds.length)
    throw new BadRequestException('阶梯达标月数不能重复');
}

export function assertConcessions(concessions: ConcessionDto[]) {
  for (const item of concessions) {
    if (item.concessionType === 'RENT_FREE' && item.applyMode !== 'DATE_RANGE')
      throw new BadRequestException('免租仅支持日期区间方式');
    if (
      item.concessionType !== 'RENT_FREE' &&
      item.applyMode !== 'BILLING_PERIODS'
    )
      throw new BadRequestException('固定金额和比例优惠仅支持指定账期数方式');
    if (
      item.applyMode === 'DATE_RANGE' &&
      (!item.startDate || !item.endDate || item.endDate < item.startDate)
    )
      throw new BadRequestException('日期区间优惠必须提供有效起止日期');
    if (item.applyMode === 'BILLING_PERIODS' && !item.billingPeriodCount)
      throw new BadRequestException('指定账期优惠必须提供账期数');
    if (
      item.concessionType === 'FIXED_AMOUNT' &&
      (!item.fixedAmount || Number(item.fixedAmount) < 0)
    )
      throw new BadRequestException('固定金额优惠必须提供非负金额');
    if (
      item.concessionType === 'PERCENTAGE' &&
      (!item.discountRate ||
        Number(item.discountRate) < 0 ||
        Number(item.discountRate) > 1)
    )
      throw new BadRequestException('比例优惠必须提供0至1之间的比例');
  }
}
