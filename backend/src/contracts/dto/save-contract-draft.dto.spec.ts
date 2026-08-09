import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SaveContractDraftDto } from './save-contract-draft.dto';

describe('SaveContractDraftDto', () => {
  it.each([
    'externalContractNo',
    'roomId',
    'primaryTenantId',
    'secondaryTenantIds',
    'startDate',
    'endDate',
    'plannedMoveInDate',
    'monthlyRent',
    'depositRequired',
    'paymentCycleMonths',
    'concessions',
    'fileAssetIds',
    'remark',
    'commission',
  ])('rejects null for optional %s', async (field) => {
    const dto = plainToInstance(SaveContractDraftDto, { [field]: null });

    const errors = await validate(dto);

    expect(errors.some((error) => error.property === field)).toBe(true);
  });
});
