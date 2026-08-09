import { RoomStatus, UserRole } from '@prisma/client';
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
        $transaction: jest.fn((callback: (tx: any) => Promise<unknown>) =>
          callback({
            room: { update },
            roomStatusHistory: { create: jest.fn() },
          }),
        ),
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

  it('updates the complete room detail payload and keeps room status out of the update', async () => {
    const update = jest.fn().mockResolvedValue({
      id: 11,
      fullHouseNo: '1栋414-415',
      roomStatus: 'EMPTY',
      building: { buildingNo: '1栋' },
    });
    const prisma = {
      db: {
        room: {
          findFirstOrThrow: jest.fn().mockResolvedValue({
            id: 11,
            buildingId: 1,
            houseNo: '414-415',
            deletedAt: null,
          }),
          update,
        },
        building: {
          findUniqueOrThrow: jest
            .fn()
            .mockResolvedValue({ id: 1, buildingNo: '1栋' }),
        },
        $transaction: jest.fn((callback: (tx: any) => Promise<unknown>) =>
          callback({
            room: { update },
            roomStatusHistory: { create: jest.fn() },
          }),
        ),
      },
    };
    const controller = new PropertiesController(prisma as never);

    await controller.updateRoom(11, {
      houseNo: '414-415',
      floorNo: 4,
      area: 88.42,
      roomType: 'RESIDENTIAL',
      decorationStatus: 'UNKNOWN',
      usageType: 'RESIDENCE',
      ownerName: '测试业主',
      ownerPhone: '13800000000',
      ownerRemark: '详情页编辑回归测试',
      remark: '414、415打通合并，一户三室一厅',
    });

    expect(update).toHaveBeenCalledWith({
      where: { id: 11 },
      data: expect.objectContaining({
        houseNo: '414-415',
        floorNo: 4,
        area: 88.42,
        roomType: 'RESIDENTIAL',
        decorationStatus: 'UNKNOWN',
        usageType: 'RESIDENCE',
        ownerName: '测试业主',
        ownerPhone: '13800000000',
        ownerRemark: '详情页编辑回归测试',
        remark: '414、415打通合并，一户三室一厅',
        fullHouseNo: '1栋414-415',
      }),
      include: { building: true },
    });
    expect(update.mock.calls[0][0].data).not.toHaveProperty('roomStatus');
  });

  it('records a status history entry when detail editing changes room status', async () => {
    const update = jest
      .fn()
      .mockResolvedValue({ id: 11, roomStatus: 'RENTED' });
    const historyCreate = jest.fn().mockResolvedValue({ id: 2 });
    const prisma = {
      db: {
        room: {
          findFirstOrThrow: jest.fn().mockResolvedValue({
            id: 11,
            buildingId: 1,
            houseNo: '101',
            roomStatus: 'EMPTY',
            deletedAt: null,
          }),
          update,
        },
        building: {
          findUniqueOrThrow: jest
            .fn()
            .mockResolvedValue({ id: 1, buildingNo: '1栋' }),
        },
        roomStatusHistory: { create: historyCreate },
        $transaction: jest.fn((callback: (tx: any) => Promise<unknown>) =>
          callback({
            room: { update },
            roomStatusHistory: { create: historyCreate },
          }),
        ),
      },
    };
    const controller = new PropertiesController(prisma as never);

    await controller.updateRoom(
      11,
      { roomStatus: 'RENTED' } as never,
      authUser,
    );

    expect(historyCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        roomId: 11,
        fromStatus: 'EMPTY',
        toStatus: 'RENTED',
        changeReason: '详情页编辑房态',
        changedBy: 7,
      }),
    });
  });

  it('combines keyword, building, status, and limit when listing rooms', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const prisma = { db: { room: { findMany } } };
    const controller = new PropertiesController(prisma as never);

    await controller.rooms({
      keyword: '601',
      buildingId: 2,
      status: RoomStatus.RENTED,
      limit: 8,
    });

    expect(findMany).toHaveBeenCalledWith({
      where: {
        deletedAt: null,
        buildingId: 2,
        roomStatus: RoomStatus.RENTED,
        OR: [
          { fullHouseNo: { contains: '601' } },
          { houseNo: { contains: '601' } },
          { ownerName: { contains: '601' } },
          { ownerPhone: { contains: '601' } },
        ],
      },
      include: { building: true },
      orderBy: [{ buildingId: 'asc' }, { floorNo: 'asc' }, { houseNo: 'asc' }],
      take: 8,
    });
  });

  it('lists all active rooms when search query is empty', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const prisma = { db: { room: { findMany } } };
    const controller = new PropertiesController(prisma as never);

    await controller.rooms({});

    expect(findMany).toHaveBeenCalledWith({
      where: { deletedAt: null },
      include: { building: true },
      orderBy: [{ buildingId: 'asc' }, { floorNo: 'asc' }, { houseNo: 'asc' }],
    });
  });
});
