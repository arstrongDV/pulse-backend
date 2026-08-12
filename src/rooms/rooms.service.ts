import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Room, RoomRole } from '@prisma/client';
import * as argon2 from 'argon2';
import { PrismaService } from '../prisma/prisma.service';
import { CreateRoomPayloadDto } from './dto/create-room.dto';
import { generateRoomCode } from '../common/utils/utils';

const MAX_CODE_ATTEMPTS = 5;

@Injectable()
export class RoomsService {
  constructor(private readonly prismaService: PrismaService) {}

  async createRoom(hostId: string, payload: CreateRoomPayloadDto) {
    const passwordHash = payload.password
      ? await argon2.hash(payload.password)
      : undefined;

    for (let attempt = 1; attempt <= MAX_CODE_ATTEMPTS; attempt++) {
      try {
        const room = await this.prismaService.$transaction(async (tx) => {
          const createdRoom = await tx.room.create({
            data: {
              hostId,
              code: generateRoomCode(),
              name: payload.name,
              visibility: payload.visibility,
              maxParticipants: payload.maxParticipants,
              passwordHash,
            },
          });

          await tx.roomMember.create({
            data: {
              roomId: createdRoom.id,
              userId: hostId,
              role: RoomRole.HOST,
            },
          });

          return createdRoom;
        });

        return this.toSafeRoom(room);
      } catch (error) {
        const isCodeCollision =
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002';
        const isLastAttempt = attempt === MAX_CODE_ATTEMPTS;

        if (!isCodeCollision || isLastAttempt) {
          throw error;
        }
      }
    }

    throw new Error('Failed to generate a unique room code');
  }

  async getRoomById(id: string) {
    const room = await this.findRoomOrThrow(id);
    return this.toSafeRoom(room);
  }

  async joinRoom(userId: string, roomId: string, password?: string) {
    const room = await this.findRoomOrThrow(roomId);

    if (room.passwordHash) {
      const passwordMatches =
        !!password && (await argon2.verify(room.passwordHash, password));
      if (!passwordMatches) {
        throw new ForbiddenException('Incorrect room password');
      }
    }

    const existingMembership = await this.prismaService.roomMember.findUnique({
      where: { roomId_userId: { roomId, userId } },
    });
    if (existingMembership && !existingMembership.leftAt) {
      throw new ConflictException('Already a member of this room');
    }

    const memberCount = await this.prismaService.roomMember.count({
      where: { roomId, leftAt: null },
    });
    if (memberCount >= room.maxParticipants) {
      throw new ConflictException('Room is full');
    }

    // upsert: brand-new join if no row exists, re-activation (clear leftAt)
    // if this user previously left. Atomic, so no P2002 race is possible.
    return this.prismaService.roomMember.upsert({
      where: { roomId_userId: { roomId, userId } },
      create: { userId, roomId, role: RoomRole.MEMBER },
      update: { leftAt: null, joinedAt: new Date() },
    });
  }

  async leaveRoom(userId: string, roomId: string) {
    const room = await this.findRoomOrThrow(roomId);

    const existingMembership = await this.prismaService.roomMember.findUnique({
      where: { roomId_userId: { roomId, userId } },
    });
    if (!existingMembership || existingMembership.leftAt) {
      throw new NotFoundException('Not a member of this room');
    }

    if (room.hostId !== userId) {
      return this.prismaService.roomMember.update({
        where: { roomId_userId: { roomId, userId } },
        data: { leftAt: new Date() },
      });
    }

    const nextHost = await this.prismaService.roomMember.findFirst({
      where: { roomId, userId: { not: userId }, leftAt: null },
      orderBy: { joinedAt: 'asc' },
    });

    if (!nextHost) {
      return this.deleteRoom(userId, roomId);
    }

    return this.prismaService.$transaction(async (tx) => {
      await tx.room.update({
        where: { id: roomId },
        data: { hostId: nextHost.userId },
      });

      await tx.roomMember.update({
        where: { roomId_userId: { roomId, userId: nextHost.userId } },
        data: { role: RoomRole.HOST },
      });

      return tx.roomMember.update({
        where: { roomId_userId: { roomId, userId } },
        data: { leftAt: new Date() },
      });
    });
  }

  async deleteRoom(userId: string, roomId: string) {
    const room = await this.findRoomOrThrow(roomId);

    if (room.hostId !== userId) {
      throw new ForbiddenException('Only host can delete room');
    }

    const deletedRoom = await this.prismaService.$transaction(async (tx) => {
      // Both room_members and messages are ON DELETE RESTRICT — the room
      // can't be deleted while either still references it.
      await tx.roomMember.deleteMany({ where: { roomId } });
      await tx.message.deleteMany({ where: { roomId } });
      return tx.room.delete({ where: { id: roomId } });
    });

    return this.toSafeRoom(deletedRoom);
  }

  private toSafeRoom(room: Room) {
    return {
      id: room.id,
      code: room.code,
      hostId: room.hostId,
      name: room.name,
      visibility: room.visibility,
      maxParticipants: room.maxParticipants,
      createdAt: room.createdAt,
      updatedAt: room.updatedAt,
    };
  }

  private async findRoomOrThrow(id: string) {
    const room = await this.prismaService.room.findUnique({
      where: { id },
    });

    if (!room) {
      throw new NotFoundException('Room not found');
    }

    return room;
  }
}
