import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PaymentListQueryDto } from './payment-list-query.dto';

describe('PaymentListQueryDto pagination', () => {
  it('uses the confirmed page defaults', async () => {
    const query = plainToInstance(PaymentListQueryDto, {});

    expect(query.page).toBe(1);
    expect(query.pageSize).toBe(10);
    await expect(validate(query)).resolves.toHaveLength(0);
  });

  it.each([
    { page: 0 },
    { page: 1.5 },
    { pageSize: 0 },
    { pageSize: 101 },
    { pageSize: 1.5 },
  ])('rejects invalid pagination values: %o', async (input) => {
    const errors = await validate(plainToInstance(PaymentListQueryDto, input));

    expect(errors.length).toBeGreaterThan(0);
  });
});
