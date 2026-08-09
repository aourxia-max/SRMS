import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ListRoomsQueryDto } from './list-rooms-query.dto';

describe('ListRoomsQueryDto', () => {
  it('trims keywords and transforms valid numeric query values', async () => {
    const dto = plainToInstance(ListRoomsQueryDto, {
      keyword: '  1栋601  ',
      buildingId: '2',
      status: 'RENTED',
      limit: '8',
    });

    await expect(validate(dto)).resolves.toHaveLength(0);
    expect(dto).toMatchObject({
      keyword: '1栋601',
      buildingId: 2,
      status: 'RENTED',
      limit: 8,
    });
  });

  it.each([
    { buildingId: '0' },
    { limit: '21' },
    { keyword: 'x'.repeat(101) },
    { status: 'UNKNOWN_STATUS' },
  ])('rejects invalid room-search query values: %o', async (input) => {
    const dto = plainToInstance(ListRoomsQueryDto, input);

    expect(await validate(dto)).not.toHaveLength(0);
  });
});
