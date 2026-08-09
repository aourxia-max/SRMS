import { TieredContractCleanupService } from './tiered-contract-cleanup.service';

function delegate(count = 0) {
  return {
    deleteMany: jest.fn().mockResolvedValue({ count }),
    updateMany: jest.fn().mockResolvedValue({ count }),
  };
}

describe('TieredContractCleanupService concurrent contract protection', () => {
  it('目标合同删除数量与事务快照不一致时回滚而不是提交部分清理', async () => {
    const contract = delegate(0);
    const tx = new Proxy(
      { contract },
      {
        get(target, property: string) {
          if (property in target)
            return target[property as keyof typeof target];
          return delegate();
        },
      },
    );
    const service = Object.create(
      TieredContractCleanupService.prototype,
    ) as TieredContractCleanupService;
    const invokeDelete = (
      service as unknown as {
        deleteRelatedRows: (
          transaction: unknown,
          scope: Record<string, number[]>,
          counts: Record<string, number>,
        ) => Promise<void>;
      }
    ).deleteRelatedRows.bind(service);
    const scope = {
      contractIds: [7],
      roomIds: [],
      pricingTierIds: [],
      rebateIds: [],
      billIds: [],
      paymentIds: [],
      refundIds: [],
      allocationIds: [],
      adjustmentIds: [],
      settlementIds: [],
      settlementItemIds: [],
      depositRefundIds: [],
      fileAssetIds: [],
    };

    await expect(invokeDelete(tx, scope, {})).rejects.toThrow(
      '目标阶梯合同数量发生变化',
    );
  });
});
