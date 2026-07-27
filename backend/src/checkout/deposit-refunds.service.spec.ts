import { DepositRefundsService } from './deposit-refunds.service';

describe('DepositRefundsService', () => {
  it('serializes refund proof file sizes for JSON responses', async () => {
    const service = new DepositRefundsService({
      db: {
        depositRefund: {
          findMany: jest.fn().mockResolvedValue([
            {
              id: 1,
              files: [
                {
                  fileAsset: { id: 1, sizeBytes: 128n },
                },
              ],
            },
          ]),
        },
      },
    } as never);

    const result = await service.list();

    expect(result[0].files[0].fileAsset.sizeBytes).toBe('128');
  });
});
