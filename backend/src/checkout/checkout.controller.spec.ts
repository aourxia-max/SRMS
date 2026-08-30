import 'reflect-metadata';
import { PATH_METADATA } from '@nestjs/common/constants';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SubmitCheckoutSettlementDto } from './dto/submit-checkout-settlement.dto';
import { CheckoutController } from './checkout.controller';

const settlementDto = (item: Record<string, unknown>) =>
  plainToInstance(SubmitCheckoutSettlementDto, {
    actualCheckoutDate: '2026-08-20',
    handoverDate: '2026-08-20',
    inspectionAt: '2026-08-20T09:00:00.000Z',
    targetRoomStatus: 'EMPTY',
    items: [item],
  });

describe('CheckoutController preview route', () => {
  it('exposes a protected settlement preview endpoint', () => {
    const preview = (
      CheckoutController.prototype as unknown as { preview?: unknown }
    ).preview;

    expect(preview).toBeDefined();
    expect(Reflect.getMetadata(PATH_METADATA, preview as object)).toBe(
      ':id/preview',
    );
  });

  it('accepts a positive rent refund with a trimmed description and no bill or inspection reference', async () => {
    const dto = settlementDto({
      itemType: 'RENT_REFUND',
      amount: '2000.00',
      description: '  提前退房退还未履行租金  ',
    });

    await expect(validate(dto)).resolves.toEqual([]);
    expect(dto.items[0].description).toBe('提前退房退还未履行租金');
  });

  it.each(['0', '-0.01', 'Infinity', 'NaN'])(
    'rejects a non-positive or non-finite rent refund amount %s',
    async (amount) => {
      const errors = await validate(
        settlementDto({
          itemType: 'RENT_REFUND',
          amount,
          description: '提前退房退还未履行租金',
        }),
      );

      expect(errors).not.toHaveLength(0);
    },
  );

  it.each(['   ', 'x'.repeat(501)])(
    'rejects an empty or oversized rent refund description',
    async (description) => {
      const errors = await validate(
        settlementDto({
          itemType: 'RENT_REFUND',
          amount: '1.00',
          description,
        }),
      );

      expect(errors).not.toHaveLength(0);
    },
  );
});
