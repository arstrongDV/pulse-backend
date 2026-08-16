import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { Prisma, Room, RoomRole } from '@prisma/client';
import * as argon2 from 'argon2';
import { PrismaService } from '../prisma/prisma.service';
import { CreateRoomPayloadDto } from './dto/create-room.dto';
import { generateRoomCode } from '../common/utils/utils';
import { CreateMessagePayloadDto } from './dto/create-message.dto';
import { EventEmitter2 } from '@nestjs/event-emitter';

const MAX_CODE_ATTEMPTS = 5;
// Short TTL is a deliberate safety net, not just a performance knob: this
// cache backs assertHost's hostId check on every playback action. Anything
// longer risks a departed host retaining playback control for the TTL
// window after a handoff — kept short enough that even without the
// explicit invalidation below, the exposure is bounded.
const ROOM_CACHE_TTL_MS = 3_000;

@Injectable()
export class RoomsService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly eventEmitter: EventEmitter2,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
  ) {}

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
    const cacheKey = this.roomCacheKey(id);
    const cached =
      await this.cache.get<ReturnType<typeof this.toSafeRoom>>(cacheKey);
    if (cached) {
      return cached;
    }

    const safeRoom = this.toSafeRoom(await this.findRoomOrThrow(id));
    await this.cache.set(cacheKey, safeRoom, ROOM_CACHE_TTL_MS);
    return safeRoom;
  }

  async getRoomByCode(code: string) {
    const cacheKey = this.roomCodeCacheKey(code);
    const cached =
      await this.cache.get<ReturnType<typeof this.toSafeRoom>>(cacheKey);
    if (cached) {
      return cached;
    }

    const room = await this.prismaService.room.findUnique({
      where: { code },
    });
    if (!room) {
      throw new NotFoundException('Room not found');
    }
    const safeRoom = this.toSafeRoom(room);
    await this.cache.set(cacheKey, safeRoom, ROOM_CACHE_TTL_MS);
    return safeRoom;
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

  async joinByCode(userId: string, code: string, password?: string) {
    const room = await this.prismaService.room.findUnique({
      where: { code },
    });
    if (!room) {
      throw new NotFoundException('Room not found');
    }

    return this.joinRoom(userId, room.id, password);
  }

  async leaveRoom(userId: string, roomId: string) {
    const room = await this.findRoomOrThrow(roomId);

    const membership = await this.prismaService.roomMember.findUnique({
      where: { roomId_userId: { roomId, userId } },
    });
    if (!membership || membership.leftAt) {
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

    const result = await this.prismaService.$transaction(async (tx) => {
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

    // hostId just changed — a stale cached entry would let the departed
    // host keep passing assertHost's check until the TTL expires.
    await this.cache.del(this.roomCacheKey(roomId));
    await this.cache.del(this.roomCodeCacheKey(room.code));
    return result;
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

    await this.cache.del(this.roomCacheKey(roomId));
    await this.cache.del(this.roomCodeCacheKey(room.code));
    return this.toSafeRoom(deletedRoom);
  }

  async createMessage(
    userId: string,
    roomId: string,
    payload: CreateMessagePayloadDto,
  ) {
    await this.findRoomOrThrow(roomId);
    await this.checkMembership(userId, roomId);

    const message = await this.prismaService.message.create({
      data: {
        roomId,
        userId,
        content: payload.content,
      },
    });

    this.eventEmitter.emit('message.create', { roomId, message });

    return message;
  }

  async getRoomMessages(userId: string, roomId: string, page = 1, limit = 10) {
    await this.findRoomOrThrow(roomId);
    await this.checkMembership(userId, roomId);

    const skip = (page - 1) * limit;

    const [items, total] = await this.prismaService.$transaction([
      this.prismaService.message.findMany({
        where: { roomId },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prismaService.message.count({ where: { roomId } }),
    ]);

    return {
      items,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
        hasNextPage: page * limit < total,
      },
    };
  }

  async addToQueue(userId: string, roomId: string, trackId: string) {
    await this.findRoomOrThrow(roomId);
    await this.checkMembership(userId, roomId);

    const track = await this.prismaService.track.findUnique({
      where: { id: trackId },
    });

    if (!track) {
      throw new NotFoundException('Track not found');
    }

    if (track.ownerId !== userId) {
      throw new ForbiddenException('You can only queue tracks you own');
    }

    return this.prismaService.roomQueueEntry.create({
      data: { roomId, trackId, addedById: userId },
    });
  }

  async getRoomQueue(userId: string, roomId: string) {
    await this.findRoomOrThrow(roomId);
    await this.checkMembership(userId, roomId);

    return this.prismaService.roomQueueEntry.findMany({
      where: { roomId },
      orderBy: { createdAt: 'asc' },
      include: { track: true },
    });
  }

  async deleteEntry(userId: string, roomId: string, entryId: string) {
    const room = await this.findRoomOrThrow(roomId);
    await this.checkMembership(userId, roomId);

    const entry = await this.prismaService.roomQueueEntry.findUnique({
      where: { id: entryId },
    });

    if (!entry || entry.roomId !== roomId) {
      throw new NotFoundException('Queue entry not found');
    }

    if (entry.addedById !== userId && room.hostId !== userId) {
      throw new ForbiddenException(
        'You can only remove your own queue entries',
      );
    }

    return this.prismaService.roomQueueEntry.delete({
      where: { id: entryId },
    });
  }

  private roomCacheKey(roomId: string) {
    return `room:${roomId}`;
  }

  // Deliberately a separate namespace from roomCacheKey — leaveRoom's
  // host-handoff and deleteRoom only invalidate the id-keyed entry, so a
  // code-keyed entry sharing that key would go stale silently, invisible
  // to that invalidation.
  private roomCodeCacheKey(code: string) {
    return `room:code:${code}`;
  }

  private async checkMembership(userId: string, roomId: string) {
    const membershp = await this.prismaService.roomMember.findUnique({
      where: { roomId_userId: { roomId, userId } },
    });

    if (!membershp || membershp.leftAt) {
      throw new ForbiddenException('Not a member of this room');
    }

    return membershp;
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
