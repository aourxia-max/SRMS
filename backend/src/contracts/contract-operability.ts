import { BadRequestException } from '@nestjs/common';
import { ContractStatus } from '@prisma/client';

export function assertContractNotVoided(
  status: ContractStatus,
  actionLabel: string,
): void {
  if (status === ContractStatus.VOIDED) {
    throw new BadRequestException(`已作废合同不能${actionLabel}`);
  }
}
