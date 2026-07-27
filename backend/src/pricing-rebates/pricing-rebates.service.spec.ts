import { PricingRebatesService } from './pricing-rebates.service';

describe('PricingRebatesService', () => {
  it('serializes uploaded proof file sizes for JSON responses', async () => {
    const findMany = jest.fn().mockResolvedValue([
      {
        id: 1,
        files: [
          {
            id: 1,
            fileAsset: { id: 1, sizeBytes: 42n },
          },
        ],
      },
    ]);
    const service = new PricingRebatesService({
      db: { pricingRebate: { findMany } },
    } as never);

    const result = await service.list();

    expect(result[0].files[0].fileAsset.sizeBytes).toBe('42');
  });
});
