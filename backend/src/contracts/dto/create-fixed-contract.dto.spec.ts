import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateFixedContractDto } from './create-fixed-contract.dto';

describe('CreateFixedContractDto', () => {
  it('does not allow the client to provide a contract number', async () => {
    const dto = plainToInstance(CreateFixedContractDto, {
      contractNo: 'HT202608050001 | 1栋101 | 李四',
      roomId: 1,
      startDate: '2026-08-05',
      endDate: '2027-08-04',
      monthlyRent: '3000',
      primaryTenantId: 1,
    });

    const errors = await validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });

    expect(errors.some((error) => error.property === 'contractNo')).toBe(true);
  });
});
