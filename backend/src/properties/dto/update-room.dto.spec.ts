import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateRoomDto } from './update-room.dto';

describe('UpdateRoomDto', () => {
  it('accepts blank optional owner and remark fields from edit forms', async () => {
    const dto = plainToInstance(UpdateRoomDto, {
      houseNo: '101',
      ownerName: '',
      ownerPhone: '',
      ownerRemark: '',
      remark: '',
    });

    await expect(validate(dto)).resolves.toHaveLength(0);
  });
});
