import { BadRequestException } from '@nestjs/common';
import { PropertyAffairStatus } from '@prisma/client';

const transitions: Record<
  PropertyAffairStatus,
  readonly PropertyAffairStatus[]
> = {
  PENDING: [
    PropertyAffairStatus.IN_PROGRESS,
    PropertyAffairStatus.COMPLETED,
    PropertyAffairStatus.CANCELLED,
  ],
  IN_PROGRESS: [PropertyAffairStatus.COMPLETED, PropertyAffairStatus.CANCELLED],
  COMPLETED: [PropertyAffairStatus.IN_PROGRESS],
  CANCELLED: [PropertyAffairStatus.IN_PROGRESS],
};

export function assertPropertyAffairTransition(
  from: PropertyAffairStatus,
  to: PropertyAffairStatus,
): void {
  if (from === to) return;

  if (!transitions[from].includes(to)) {
    throw new BadRequestException('事项状态不能这样变更');
  }
}
