import { UserRole } from '@prisma/client';
import { PropertiesController } from './properties.controller';

describe('PropertiesController', () => {
  type CreateRoomTransaction = {
    room: { create: jest.Mock };
    roomStatusHistory: { create: jest.Mock };
  };
  const authUser = {
    id: 7,
    username: 'admin',
    displayName: '管理员',
    role: UserRole.ADMIN,
  };

  it('creates a room and writes its initial status history with operator', async () => {
    const create = jest.fn().mockResolvedValue({ id: 11 });
    const historyCreate = jest.fn().mockResolvedValue({ id: 1 });
    const prisma = {
      db: {
        building: {
          findUniqueOrThrow: jest
            .fn()
            .mockResolvedValue({ id: 2, buildingNo: '1栋' }),
        },
        $transaction: jest.fn(
          (callback: (tx: CreateRoomTransaction) => Promise<unknown>) =>
            callback({
              room: { create },
              roomStatusHistory: { create: historyCreate },
            }),
        ),
      },
    };
    const controller = new PropertiesController(prisma as never);

    await controller.createRoom(
      {
        buildingId: 2,
        houseNo: '101',
        floorNo: 1,
        roomType: 'RESIDENTIAL',
        decorationStatus: 'UNKNOWN',
        usageType: 'RESIDENCE',
      },
      authUser,
    );

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          fullHouseNo: '1栋101',
          roomStatus: 'EMPTY',
        }),
      }),
    );
    expect(historyCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        roomId: 11,
        toStatus: 'EMPTY',
        changedBy: 7,
      }),
    });
  });

  it('rebuilds full house number when a room is moved or renumbered', async () => {
    const update = jest
      .fn()
      .mockResolvedValue({ id: 11, fullHouseNo: '2栋201' });
    const prisma = {
      db: {
        room: {
          findFirstOrThrow: jest.fn().mockResolvedValue({
            id: 11,
            buildingId: 1,
            houseNo: '101',
            deletedAt: null,
          }),
          update,
        },
        building: {
          findUniqueOrThrow: jest
            .fn()
            .mockResolvedValue({ id: 2, buildingNo: '2栋' }),
        },
      },
    };
    const controller = new PropertiesController(prisma as never);

    await controller.updateRoom(11, { buildingId: 2, houseNo: '201' });

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          buildingId: 2,
          houseNo: '201',
          fullHouseNo: '2栋201',
        }),
      }),
    );
  });
});
