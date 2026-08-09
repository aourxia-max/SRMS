import { TieredContractCleanupService } from './tiered-contract-cleanup.service';

function ordinaryDelegate(count = 0) {
  return {
    deleteMany: jest.fn().mockResolvedValue({ count }),
    updateMany: jest.fn().mockResolvedValue({ count }),
  };
}

describe('TieredContractCleanupService self-referencing rebates', () => {
  it('删除退差父子记录前先解除目标集合内部的 parent_rebate_id', async () => {
    let parentReferenceDetached = false;
    const pricingRebate = {
      updateMany: jest.fn().mockImplementation(() => {
        parentReferenceDetached = true;
        return Promise.resolve({ count: 1 });
      }),
      deleteMany: jest.fn().mockImplementation(() => {
        if (!parentReferenceDetached) {
          throw new Error('fk_rebate_parent');
        }
        return Promise.resolve({ count: 2 });
      }),
    };
    const tx = new Proxy(
      { pricingRebate, contract: ordinaryDelegate(1) },
      {
        get(target, property: string) {
          if (property in target)
            return target[property as keyof typeof target];
          return ordinaryDelegate();
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
    const emptyScope = {
      contractIds: [7],
      roomIds: [],
      pricingTierIds: [],
      rebateIds: [71, 72],
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

    await invokeDelete(tx, emptyScope, {});

    expect(pricingRebate.updateMany).toHaveBeenCalledWith({
      where: { id: { in: [71, 72] } },
      data: { parentRebateId: null },
    });
    expect(pricingRebate.deleteMany).toHaveBeenCalled();
  });
});
