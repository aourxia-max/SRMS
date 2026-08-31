import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateContractRemarkDto } from './update-contract-remark.dto';

describe('UpdateContractRemarkDto', () => {
  it.each([
    { remark: null },
    { remark: '' },
    { remark: '补充说明' },
    { remark: '备'.repeat(500) },
  ])(
    'accepts a nullable remark no longer than 500 characters',
    async (input) => {
      const dto = plainToInstance(UpdateContractRemarkDto, input);

      await expect(validate(dto)).resolves.toHaveLength(0);
    },
  );

  it.each([{ remark: 123 }, { remark: '备'.repeat(501) }])(
    'rejects invalid remark input',
    async (input) => {
      const dto = plainToInstance(UpdateContractRemarkDto, input);

      const errors = await validate(dto);

      expect(errors.some((error) => error.property === 'remark')).toBe(true);
      expect(
        errors
          .flatMap((error) => Object.values(error.constraints ?? {}))
          .join(' '),
      ).toMatch(/备注/);
    },
  );
});
