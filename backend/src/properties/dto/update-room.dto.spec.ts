import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateRoomDto } from './update-room.dto';

describe('UpdateRoomDto', () => {
  it('converts blank optional owner and remark fields to null so edits can clear them', async () => {
    const dto = plainToInstance(UpdateRoomDto, {
      houseNo: '101',
      ownerName: '',
      ownerPhone: '',
      ownerRemark: '',
      remark: '',
    });

    await expect(validate(dto)).resolves.toHaveLength(0);
    expect(dto.ownerName).toBeNull();
    expect(dto.ownerPhone).toBeNull();
    expect(dto.ownerRemark).toBeNull();
    expect(dto.remark).toBeNull();
  });
});
