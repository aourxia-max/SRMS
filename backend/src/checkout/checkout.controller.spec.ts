import 'reflect-metadata';
import { PATH_METADATA } from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CheckoutFinanceSnapshotQueryDto } from './dto/checkout-finance-snapshot-query.dto';
import { InitiateCheckoutDto } from './dto/initiate-checkout.dto';
import { SubmitCheckoutSettlementDto } from './dto/submit-checkout-settlement.dto';
import { CheckoutController } from './checkout.controller';
import { CheckoutService } from './checkout.service';

const settlementDto = (item: Record<string, unknown>) =>
  plainToInstance(SubmitCheckoutSettlementDto, {
    actualCheckoutDate: '2026-08-20',
    handoverDate: '2026-08-20',
    inspectionAt: '2026-08-20T09:00:00.000Z',
    targetRoomStatus: 'EMPTY',
    items: [item],
  });

describe('CheckoutController preview route', () => {
  it('forwards the optional actual checkout date to the finance snapshot', async () => {
    const getFinanceSnapshot = jest.fn().mockResolvedValue({
      rentOutstanding: '0.00',
      futureBillCount: 1,
    });
    const moduleRef = await Test.createTestingModule({
      controllers: [CheckoutController],
      providers: [
        {
          provide: CheckoutService,
          useValue: { getFinanceSnapshot },
        },
      ],
    }).compile();
    const controller = moduleRef.get(CheckoutController);

    await expect(
      controller.financeSnapshot(8, {
        actualCheckoutDate: '2026-09-01',
      }),
    ).resolves.toEqual({
      code: 200,
      message: 'success',
      data: { rentOutstanding: '0.00', futureBillCount: 1 },
    });
    expect(getFinanceSnapshot).toHaveBeenCalledWith(8, '2026-09-01');
  });

  it('rejects an invalid actual checkout date at initiation through DTO validation', async () => {
    const dto = plainToInstance(InitiateCheckoutDto, {
      checkoutType: '提前退租',
      plannedCheckoutDate: '2026-09-01',
      actualCheckoutDate: 'not-a-date',
      handoverDate: '2026-09-01',
      inspectionAt: '2026-09-01',
      checkoutReason: '租户已退房，补录申请',
      targetRoomStatus: 'EMPTY',
    });

    const errors = await validate(dto);

    expect(
      errors.some((error) => error.property === 'actualCheckoutDate'),
    ).toBe(true);
  });

  it('rejects an invalid finance snapshot date through query DTO validation', async () => {
    const query = plainToInstance(CheckoutFinanceSnapshotQueryDto, {
      actualCheckoutDate: 'not-a-date',
    });

    const errors = await validate(query);

    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({
      property: 'actualCheckoutDate',
      constraints: {
        isDateString: 'actualCheckoutDate must be a valid ISO 8601 date string',
      },
    });
  });

  it('exposes a super-admin completed-checkout revoke endpoint', async () => {
    const revokeCompleted = (
      CheckoutController.prototype as unknown as {
        revokeCompleted?: unknown;
      }
    ).revokeCompleted;
    expect(revokeCompleted).toBeDefined();
    expect(Reflect.getMetadata(PATH_METADATA, revokeCompleted as object)).toBe(
      ':id/revoke-completed',
    );

    const checkout = {
      revokeCompleted: jest.fn().mockResolvedValue({ id: 9 }),
    };
    const controller = new CheckoutController(checkout as never);
    await expect(
      (controller as any).revokeCompleted(9, {
        id: 1,
        username: 'root',
        role: 'SUPER_ADMIN',
      }),
    ).resolves.toEqual({ code: 200, message: 'success', data: { id: 9 } });
  });

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

  it.each([
    0.01,
    '0',
    '-0.01',
    '0.001',
    '1000000000000.00',
    '1e2',
    'Infinity',
    'NaN',
  ])(
    'rejects rent refund amount outside DECIMAL(14,2) ordinary-string format: %p',
    async (amount) => {
      const errors = await validate(
        settlementDto({
          itemType: 'RENT_REFUND',
          amount,
          description: '提前退房退还未履行租金',
        }),
      );

      expect(errors).not.toHaveLength(0);
      expect(JSON.stringify(errors)).toContain(
        '结算项目金额必须是大于零、最多12位整数和2位小数的普通十进制字符串',
      );
    },
  );

  it('accepts the maximum DECIMAL(14,2) rent refund amount', async () => {
    await expect(
      validate(
        settlementDto({
          itemType: 'RENT_REFUND',
          amount: '999999999999.99',
          description: '提前退房退还未履行租金',
        }),
      ),
    ).resolves.toEqual([]);
  });

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
