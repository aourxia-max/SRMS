import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/auth-user.type';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../authorization/roles.decorator';
import { RolesGuard } from '../authorization/roles.guard';
import { PrismaService } from '../prisma/prisma.service';
import { CreateBuildingDto } from './dto/create-building.dto';
import { CreateRoomDto } from './dto/create-room.dto';
import { ChangeRoomStatusDto } from './dto/change-room-status.dto';
import { UpdateBuildingDto } from './dto/update-building.dto';
import { UpdateRoomDto } from './dto/update-room.dto';

@Controller('properties')
@UseGuards(JwtAuthGuard)
export class PropertiesController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('buildings')
  async buildings() {
    return {
      code: 200,
      message: 'success',
      data: await this.prisma.db.building.findMany({
        orderBy: { sortOrder: 'asc' },
      }),
    };
  }

  @Post('buildings')
  @UseGuards(RolesGuard)
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  async createBuilding(@Body() dto: CreateBuildingDto) {
    return {
      code: 200,
      message: 'success',
      data: await this.prisma.db.building.create({ data: dto }),
    };
  }

  @Patch('buildings/:id')
  @UseGuards(RolesGuard)
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  async updateBuilding(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateBuildingDto,
  ) {
    const building = await this.prisma.db.building.findUniqueOrThrow({
      where: { id },
    });
    const buildingNo = dto.buildingNo ?? building.buildingNo;
    const updated = await this.prisma.db.$transaction(async (tx) => {
      const result = await tx.building.update({ where: { id }, data: dto });
      if (dto.buildingNo && dto.buildingNo !== building.buildingNo) {
        const rooms = await tx.room.findMany({ where: { buildingId: id } });
        await Promise.all(
          rooms.map((room) =>
            tx.room.update({
              where: { id: room.id },
              data: { fullHouseNo: `${buildingNo}${room.houseNo}` },
            }),
          ),
        );
      }
      return result;
    });
    return { code: 200, message: 'success', data: updated };
  }

  @Post('rooms')
  @UseGuards(RolesGuard)
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  async createRoom(@Body() dto: CreateRoomDto, @CurrentUser() user: AuthUser) {
    const building = await this.prisma.db.building.findUniqueOrThrow({
      where: { id: dto.buildingId },
    });
    const status = dto.roomStatus ?? 'EMPTY';
    const room = await this.prisma.db.$transaction(async (tx) => {
      const created = await tx.room.create({
        data: {
          ...dto,
          roomStatus: status,
          fullHouseNo: `${building.buildingNo}${dto.houseNo}`,
        },
      });
      await tx.roomStatusHistory.create({
        data: {
          roomId: created.id,
          toStatus: status,
          changeReason: '房源建档',
          changedBy: user.id,
        },
      });
      return created;
    });
    return { code: 200, message: 'success', data: room };
  }

  @Get('rooms/:id/history')
  async history(@Param('id', ParseIntPipe) id: number) {
    return {
      code: 200,
      message: 'success',
      data: await this.prisma.db.roomStatusHistory.findMany({
        where: { roomId: id },
        orderBy: { changedAt: 'desc' },
      }),
    };
  }

  @Patch('rooms/:id/status')
  @UseGuards(RolesGuard)
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  async changeStatus(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ChangeRoomStatusDto,
    @CurrentUser() user: AuthUser,
  ) {
    const room = await this.prisma.db.room.findFirstOrThrow({
      where: { id, deletedAt: null },
    });
    const updated = await this.prisma.db.$transaction(async (tx) => {
      const result = await tx.room.update({
        where: { id },
        data: { roomStatus: dto.roomStatus, statusChangedAt: new Date() },
      });
      if (room.roomStatus !== dto.roomStatus)
        await tx.roomStatusHistory.create({
          data: {
            roomId: id,
            fromStatus: room.roomStatus,
            toStatus: dto.roomStatus,
            changeReason: dto.reason,
            changedBy: user.id,
          },
        });
      return result;
    });
    return { code: 200, message: 'success', data: updated };
  }

  @Patch('rooms/:id')
  @UseGuards(RolesGuard)
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  async updateRoom(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateRoomDto,
  ) {
    const room = await this.prisma.db.room.findFirstOrThrow({
      where: { id, deletedAt: null },
    });
    const buildingId = dto.buildingId ?? room.buildingId;
    const houseNo = dto.houseNo ?? room.houseNo;
    const building = await this.prisma.db.building.findUniqueOrThrow({
      where: { id: buildingId },
    });
    const updated = await this.prisma.db.room.update({
      where: { id },
      data: { ...dto, fullHouseNo: `${building.buildingNo}${houseNo}` },
      include: { building: true },
    });
    return { code: 200, message: 'success', data: updated };
  }

  @Get('rooms')
  async rooms() {
    return {
      code: 200,
      message: 'success',
      data: await this.prisma.db.room.findMany({
        where: { deletedAt: null },
        include: { building: true },
        orderBy: [
          { buildingId: 'asc' },
          { floorNo: 'asc' },
          { houseNo: 'asc' },
        ],
      }),
    };
  }

  @Delete('rooms/:id')
  @UseGuards(RolesGuard)
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  async deleteRoom(@Param('id', ParseIntPipe) id: number) {
    await this.prisma.db.room.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    return { code: 200, message: 'success', data: null };
  }
}
