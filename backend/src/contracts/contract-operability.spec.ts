import { BadRequestException } from '@nestjs/common';
import { assertContractNotVoided } from './contract-operability';

describe('assertContractNotVoided', () => {
  it.each([
    ['登记收款', '已作废合同不能登记收款'],
    ['提交账单调整', '已作废合同不能提交账单调整'],
    ['发起退款', '已作废合同不能发起退款'],
    ['发起收款作废', '已作废合同不能发起收款作废'],
    ['提交租金退差', '已作废合同不能提交租金退差'],
    ['发起退租', '已作废合同不能发起退租'],
    ['登记押金收取', '已作废合同不能登记押金收取'],
    ['登记押金退款', '已作废合同不能登记押金退款'],
    ['新增租房提成', '已作废合同不能新增租房提成'],
    ['提交合同变更', '已作废合同不能提交合同变更'],
  ])(
    'rejects VOIDED for %s with an action-specific message',
    (label, message) => {
      expect(() => assertContractNotVoided('VOIDED', label)).toThrow(
        new BadRequestException(message),
      );
    },
  );

  it.each([
    'DRAFT',
    'PENDING_START',
    'ACTIVE',
    'PENDING_CHECKOUT',
    'ENDED',
  ] as const)('allows the non-voided %s status', (status) => {
    expect(() => assertContractNotVoided(status, '登记收款')).not.toThrow();
  });
});
