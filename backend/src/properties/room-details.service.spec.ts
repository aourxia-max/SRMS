import { RoomDetailsService } from './room-details.service';

describe('RoomDetailsService', () => {
  it('does not return financial details to an administrator', async () => {
    const prisma = {
      db: {
        room: {
          findFirstOrThrow: jest.fn().mockResolvedValue({
            id: 11,
            roomStatus: 'EMPTY',
            building: { buildingNo: 'TEST-B1', buildingName: '测试楼' },
            histories: [],
            contracts: [],
          }),
        },
      },
    } as any;
    const service = new RoomDetailsService(prisma);

    const result = await service.detail(11, { id: 2, role: 'ADMIN' });

    expect(result).not.toHaveProperty('financial');
    expect(result.riskLabels).toEqual(['当前无待办']);
  });
});
