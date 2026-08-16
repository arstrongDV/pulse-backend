import { Test, TestingModule } from '@nestjs/testing';
import { Prisma, RoomRole, RoomVisibility } from '@prisma/client';
import * as argon2 from 'argon2';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { RoomsService } from './rooms.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';

describe('RoomsService', () => {
  let service: RoomsService;

  const txMock = {
    room: {
      create: jest.fn(),
      delete: jest.fn(),
      update: jest.fn(),
    },
    roomMember: {
      create: jest.fn(),
      deleteMany: jest.fn(),
      update: jest.fn(),
    },
    message: {
      deleteMany: jest.fn(),
    },
  };
  const prismaMock = {
    $transaction: jest.fn(),
    room: {
      findUnique: jest.fn(),
    },
    roomMember: {
      count: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      upsert: jest.fn(),
      update: jest.fn(),
    },
    message: {
      create: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
    track: {
      findUnique: jest.fn(),
    },
    roomQueueEntry: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      delete: jest.fn(),
    },
  };
  const eventEmitterMock = {
    emit: jest.fn(),
  };
  const cacheMock = {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
  };

  const baseRoom = {
    id: 'room-1',
    code: 'ABC123',
    hostId: 'user-1',
    name: 'My room',
    passwordHash: null,
    visibility: RoomVisibility.PUBLIC,
    maxParticipants: 5,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RoomsService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: EventEmitter2, useValue: eventEmitterMock },
        { provide: CACHE_MANAGER, useValue: cacheMock },
      ],
    }).compile();

    service = module.get<RoomsService>(RoomsService);

    jest.clearAllMocks();
    prismaMock.$transaction.mockImplementation(
      (arg: ((tx: typeof txMock) => unknown) | Promise<unknown>[]) =>
        Array.isArray(arg) ? Promise.all(arg) : arg(txMock),
    );
    prismaMock.roomMember.count.mockResolvedValue(1);
    prismaMock.roomMember.findUnique.mockResolvedValue(null);
    cacheMock.get.mockResolvedValue(undefined);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('creates the room and adds the host as a member, without leaking passwordHash', async () => {
    txMock.room.create.mockResolvedValue(baseRoom);
    txMock.roomMember.create.mockResolvedValue({});

    const result = await service.createRoom('user-1', {
      name: 'My room',
      visibility: RoomVisibility.PUBLIC,
      maxParticipants: 5,
    });

    expect(txMock.roomMember.create).toHaveBeenCalledWith({
      data: { roomId: 'room-1', userId: 'user-1', role: RoomRole.HOST },
    });
    expect(result).not.toHaveProperty('passwordHash');
    expect(result.code).toBe('ABC123');
  });

  it('hashes the password when one is provided', async () => {
    let capturedPasswordHash: string | null | undefined;
    txMock.room.create.mockImplementation(
      (args: { data: { passwordHash?: string } }) => {
        capturedPasswordHash = args.data.passwordHash;
        return Promise.resolve(baseRoom);
      },
    );
    txMock.roomMember.create.mockResolvedValue({});

    await service.createRoom('user-1', {
      visibility: RoomVisibility.PRIVATE,
      maxParticipants: 5,
      password: 'super-secret',
    });

    expect(capturedPasswordHash).toBeDefined();
    expect(capturedPasswordHash).not.toBe('super-secret');
  });

  it('retries when the generated code collides, then succeeds', async () => {
    const collisionError = new Prisma.PrismaClientKnownRequestError(
      'Unique constraint failed on the fields: (`code`)',
      { code: 'P2002', clientVersion: '7.9.1' },
    );

    txMock.room.create
      .mockRejectedValueOnce(collisionError)
      .mockResolvedValueOnce(baseRoom);
    txMock.roomMember.create.mockResolvedValue({});

    const result = await service.createRoom('user-1', {
      visibility: RoomVisibility.PUBLIC,
      maxParticipants: 5,
    });

    expect(txMock.room.create).toHaveBeenCalledTimes(2);
    expect(result.code).toBe('ABC123');
  });

  it('does not retry and rethrows on a non-collision error', async () => {
    txMock.room.create.mockRejectedValue(new Error('DB is down'));

    await expect(
      service.createRoom('user-1', {
        visibility: RoomVisibility.PUBLIC,
        maxParticipants: 5,
      }),
    ).rejects.toThrow('DB is down');
    expect(txMock.room.create).toHaveBeenCalledTimes(1);
  });

  describe('getRoomById', () => {
    it('returns the room without passwordHash', async () => {
      prismaMock.room.findUnique.mockResolvedValue(baseRoom);

      const result = await service.getRoomById('room-1');

      expect(prismaMock.room.findUnique).toHaveBeenCalledWith({
        where: { id: 'room-1' },
      });
      expect(result).not.toHaveProperty('passwordHash');
      expect(result).toEqual({
        id: baseRoom.id,
        code: baseRoom.code,
        hostId: baseRoom.hostId,
        name: baseRoom.name,
        visibility: baseRoom.visibility,
        maxParticipants: baseRoom.maxParticipants,
        createdAt: baseRoom.createdAt,
        updatedAt: baseRoom.updatedAt,
      });
    });

    it('throws NotFoundException when room is not found', async () => {
      prismaMock.room.findUnique.mockResolvedValue(null);

      await expect(service.getRoomById('non-existent-id')).rejects.toThrow(
        NotFoundException,
      );
      expect(prismaMock.room.findUnique).toHaveBeenCalledWith({
        where: { id: 'non-existent-id' },
      });
    });

    it('caches the result and serves the next call from cache without hitting Prisma', async () => {
      prismaMock.room.findUnique.mockResolvedValue(baseRoom);

      await service.getRoomById('room-1');
      expect(cacheMock.set).toHaveBeenCalledWith(
        'room:room-1',
        expect.objectContaining({ id: 'room-1' }) as unknown,
        3_000,
      );

      cacheMock.get.mockResolvedValue({ id: 'room-1', hostId: 'user-1' });
      const result = await service.getRoomById('room-1');

      expect(result).toEqual({ id: 'room-1', hostId: 'user-1' });
      expect(prismaMock.room.findUnique).toHaveBeenCalledTimes(1);
    });
  });

  describe('joinRoom', () => {
    it('adds the user as a MEMBER when the room has no password', async () => {
      prismaMock.room.findUnique.mockResolvedValue(baseRoom);
      prismaMock.roomMember.upsert.mockResolvedValue({
        id: 'member-1',
        roomId: 'room-1',
        userId: 'user-2',
        role: RoomRole.MEMBER,
        joinedAt: new Date(),
        leftAt: null,
      });

      await service.joinRoom('user-2', 'room-1');

      expect(prismaMock.roomMember.upsert).toHaveBeenCalledWith({
        where: { roomId_userId: { roomId: 'room-1', userId: 'user-2' } },
        create: { userId: 'user-2', roomId: 'room-1', role: RoomRole.MEMBER },
        update: { leftAt: null, joinedAt: expect.any(Date) as Date },
      });
    });

    it('reactivates the membership when the user previously left', async () => {
      prismaMock.room.findUnique.mockResolvedValue(baseRoom);
      prismaMock.roomMember.findUnique.mockResolvedValue({
        id: 'member-1',
        roomId: 'room-1',
        userId: 'user-2',
        role: RoomRole.MEMBER,
        joinedAt: new Date('2026-01-01'),
        leftAt: new Date('2026-01-02'),
      });
      prismaMock.roomMember.upsert.mockResolvedValue({});

      await service.joinRoom('user-2', 'room-1');

      expect(prismaMock.roomMember.upsert).toHaveBeenCalled();
    });

    it('throws NotFoundException and never attempts to join when the room does not exist', async () => {
      prismaMock.room.findUnique.mockResolvedValue(null);

      await expect(service.joinRoom('user-2', 'no-such-room')).rejects.toThrow(
        NotFoundException,
      );
      expect(prismaMock.roomMember.upsert).not.toHaveBeenCalled();
    });

    it('rejects joining a room the user is already an active member of', async () => {
      prismaMock.room.findUnique.mockResolvedValue(baseRoom);
      prismaMock.roomMember.findUnique.mockResolvedValue({
        id: 'member-1',
        roomId: 'room-1',
        userId: 'user-2',
        role: RoomRole.MEMBER,
        joinedAt: new Date(),
        leftAt: null,
      });

      await expect(service.joinRoom('user-2', 'room-1')).rejects.toThrow(
        ConflictException,
      );
      expect(prismaMock.roomMember.upsert).not.toHaveBeenCalled();
    });

    it('rejects when the room is full', async () => {
      prismaMock.room.findUnique.mockResolvedValue(baseRoom); // maxParticipants: 5
      prismaMock.roomMember.count.mockResolvedValue(5);

      await expect(service.joinRoom('user-2', 'room-1')).rejects.toThrow(
        ConflictException,
      );
      expect(prismaMock.roomMember.upsert).not.toHaveBeenCalled();
    });

    it('rejects joining a password-protected room with no password given', async () => {
      const protectedRoom = {
        ...baseRoom,
        passwordHash: await argon2.hash('room-secret'),
      };
      prismaMock.room.findUnique.mockResolvedValue(protectedRoom);

      await expect(service.joinRoom('user-2', 'room-1')).rejects.toThrow(
        ForbiddenException,
      );
      expect(prismaMock.roomMember.upsert).not.toHaveBeenCalled();
    });

    it('rejects joining a password-protected room with the wrong password', async () => {
      const protectedRoom = {
        ...baseRoom,
        passwordHash: await argon2.hash('room-secret'),
      };
      prismaMock.room.findUnique.mockResolvedValue(protectedRoom);

      await expect(
        service.joinRoom('user-2', 'room-1', 'wrong-password'),
      ).rejects.toThrow(ForbiddenException);
      expect(prismaMock.roomMember.upsert).not.toHaveBeenCalled();
    });

    it('allows joining a password-protected room with the correct password', async () => {
      const protectedRoom = {
        ...baseRoom,
        passwordHash: await argon2.hash('room-secret'),
      };
      prismaMock.room.findUnique.mockResolvedValue(protectedRoom);
      prismaMock.roomMember.upsert.mockResolvedValue({});

      await service.joinRoom('user-2', 'room-1', 'room-secret');

      expect(prismaMock.roomMember.upsert).toHaveBeenCalled();
    });
  });

  describe('joinByCode', () => {
    it('resolves the code to a room and delegates to joinRoom', async () => {
      prismaMock.room.findUnique.mockResolvedValue(baseRoom); // id: room-1
      const joinRoomSpy = jest
        .spyOn(service, 'joinRoom')
        .mockResolvedValue({} as never);

      await service.joinByCode('user-2', 'ABC123', 'room-secret');

      expect(prismaMock.room.findUnique).toHaveBeenCalledWith({
        where: { code: 'ABC123' },
      });
      expect(joinRoomSpy).toHaveBeenCalledWith(
        'user-2',
        'room-1',
        'room-secret',
      );
    });

    it('throws NotFoundException when no room matches the code', async () => {
      prismaMock.room.findUnique.mockResolvedValue(null);
      const joinRoomSpy = jest.spyOn(service, 'joinRoom');

      await expect(service.joinByCode('user-2', 'NOPE12')).rejects.toThrow(
        NotFoundException,
      );
      expect(joinRoomSpy).not.toHaveBeenCalled();
    });
  });

  describe('leaveRoom', () => {
    it('sets leftAt on the membership', async () => {
      prismaMock.room.findUnique.mockResolvedValue(baseRoom); // hostId: 'user-1'
      prismaMock.roomMember.findUnique.mockResolvedValue({
        id: 'member-1',
        roomId: 'room-1',
        userId: 'user-2',
        role: RoomRole.MEMBER,
        joinedAt: new Date(),
        leftAt: null,
      });
      prismaMock.roomMember.update.mockResolvedValue({});

      await service.leaveRoom('user-2', 'room-1');

      expect(prismaMock.roomMember.update).toHaveBeenCalledWith({
        where: { roomId_userId: { roomId: 'room-1', userId: 'user-2' } },
        data: { leftAt: expect.any(Date) as Date },
      });
    });

    it('throws NotFoundException when the room does not exist', async () => {
      prismaMock.room.findUnique.mockResolvedValue(null);

      await expect(service.leaveRoom('user-2', 'no-such-room')).rejects.toThrow(
        NotFoundException,
      );
      expect(prismaMock.roomMember.update).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the user was never a member', async () => {
      prismaMock.room.findUnique.mockResolvedValue(baseRoom);
      prismaMock.roomMember.findUnique.mockResolvedValue(null);

      await expect(service.leaveRoom('user-2', 'room-1')).rejects.toThrow(
        NotFoundException,
      );
      expect(prismaMock.roomMember.update).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the user already left', async () => {
      prismaMock.room.findUnique.mockResolvedValue(baseRoom);
      prismaMock.roomMember.findUnique.mockResolvedValue({
        id: 'member-1',
        roomId: 'room-1',
        userId: 'user-2',
        role: RoomRole.MEMBER,
        joinedAt: new Date(),
        leftAt: new Date(),
      });

      await expect(service.leaveRoom('user-2', 'room-1')).rejects.toThrow(
        NotFoundException,
      );
      expect(prismaMock.roomMember.update).not.toHaveBeenCalled();
    });

    it('hands the room off to the longest-standing member when the host leaves', async () => {
      prismaMock.room.findUnique.mockResolvedValue(baseRoom); // hostId: 'user-1'
      prismaMock.roomMember.findUnique.mockResolvedValue({
        id: 'member-host',
        roomId: 'room-1',
        userId: 'user-1',
        role: RoomRole.HOST,
        joinedAt: new Date('2026-01-01'),
        leftAt: null,
      });
      prismaMock.roomMember.findFirst.mockResolvedValue({
        id: 'member-2',
        roomId: 'room-1',
        userId: 'user-2',
        role: RoomRole.MEMBER,
        joinedAt: new Date('2026-01-02'),
        leftAt: null,
      });
      txMock.room.update.mockResolvedValue({});
      txMock.roomMember.update.mockResolvedValue({});

      await service.leaveRoom('user-1', 'room-1');

      expect(prismaMock.roomMember.findFirst).toHaveBeenCalledWith({
        where: { roomId: 'room-1', userId: { not: 'user-1' }, leftAt: null },
        orderBy: { joinedAt: 'asc' },
      });
      expect(txMock.room.update).toHaveBeenCalledWith({
        where: { id: 'room-1' },
        data: { hostId: 'user-2' },
      });
      expect(txMock.roomMember.update).toHaveBeenCalledWith({
        where: { roomId_userId: { roomId: 'room-1', userId: 'user-2' } },
        data: { role: RoomRole.HOST },
      });
      expect(txMock.roomMember.update).toHaveBeenCalledWith({
        where: { roomId_userId: { roomId: 'room-1', userId: 'user-1' } },
        data: { leftAt: expect.any(Date) as Date },
      });
      // hostId changed — a stale cache would let the departed host keep
      // passing assertHost's check. Both the id- and code-keyed entries
      // need invalidating — they're independent cache entries.
      expect(cacheMock.del).toHaveBeenCalledWith('room:room-1');
      expect(cacheMock.del).toHaveBeenCalledWith(`room:code:${baseRoom.code}`);
    });

    it('deletes the room when the host leaves and no other active member remains', async () => {
      prismaMock.room.findUnique.mockResolvedValue(baseRoom); // hostId: 'user-1'
      prismaMock.roomMember.findUnique.mockResolvedValue({
        id: 'member-host',
        roomId: 'room-1',
        userId: 'user-1',
        role: RoomRole.HOST,
        joinedAt: new Date(),
        leftAt: null,
      });
      prismaMock.roomMember.findFirst.mockResolvedValue(null);
      const deleteRoomSpy = jest
        .spyOn(service, 'deleteRoom')
        .mockResolvedValue({} as never);

      await service.leaveRoom('user-1', 'room-1');

      expect(deleteRoomSpy).toHaveBeenCalledWith('user-1', 'room-1');
    });
  });

  describe('deleteRoom', () => {
    it('deletes memberships, messages, then the room when called by the host', async () => {
      prismaMock.room.findUnique.mockResolvedValue(baseRoom); // hostId: 'user-1'
      txMock.roomMember.deleteMany.mockResolvedValue({ count: 2 });
      txMock.message.deleteMany.mockResolvedValue({ count: 5 });
      txMock.room.delete.mockResolvedValue(baseRoom);

      const result = await service.deleteRoom('user-1', 'room-1');

      expect(txMock.roomMember.deleteMany).toHaveBeenCalledWith({
        where: { roomId: 'room-1' },
      });
      expect(txMock.message.deleteMany).toHaveBeenCalledWith({
        where: { roomId: 'room-1' },
      });
      expect(txMock.room.delete).toHaveBeenCalledWith({
        where: { id: 'room-1' },
      });
      expect(cacheMock.del).toHaveBeenCalledWith('room:room-1');
      expect(cacheMock.del).toHaveBeenCalledWith(`room:code:${baseRoom.code}`);
      expect(result).not.toHaveProperty('passwordHash');
      expect(result.id).toBe('room-1');
    });

    it('throws ForbiddenException when called by someone other than the host', async () => {
      prismaMock.room.findUnique.mockResolvedValue(baseRoom); // hostId: 'user-1'

      await expect(service.deleteRoom('user-2', 'room-1')).rejects.toThrow(
        ForbiddenException,
      );
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the room does not exist', async () => {
      prismaMock.room.findUnique.mockResolvedValue(null);

      await expect(
        service.deleteRoom('user-1', 'no-such-room'),
      ).rejects.toThrow(NotFoundException);
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('createMessage', () => {
    it('creates the message when the sender is an active member', async () => {
      prismaMock.room.findUnique.mockResolvedValue(baseRoom);
      prismaMock.roomMember.findUnique.mockResolvedValue({
        id: 'member-1',
        roomId: 'room-1',
        userId: 'user-2',
        role: RoomRole.MEMBER,
        joinedAt: new Date(),
        leftAt: null,
      });
      const createdMessage = {
        id: 'message-1',
        roomId: 'room-1',
        userId: 'user-2',
        content: 'hello room',
        createdAt: new Date(),
        updatedAt: null,
      };
      prismaMock.message.create.mockResolvedValue(createdMessage);

      const result = await service.createMessage('user-2', 'room-1', {
        content: 'hello room',
      });

      expect(prismaMock.message.create).toHaveBeenCalledWith({
        data: { roomId: 'room-1', userId: 'user-2', content: 'hello room' },
      });
      expect(result).toEqual(createdMessage);
      // Guards against the create() call losing its `await`: the emitted
      // payload must be the resolved message, not a pending Promise.
      expect(eventEmitterMock.emit).toHaveBeenCalledWith('message.create', {
        roomId: 'room-1',
        message: createdMessage,
      });
    });

    it('throws NotFoundException when the room does not exist', async () => {
      prismaMock.room.findUnique.mockResolvedValue(null);

      await expect(
        service.createMessage('user-2', 'no-such-room', {
          content: 'hello',
        }),
      ).rejects.toThrow(NotFoundException);
      expect(prismaMock.message.create).not.toHaveBeenCalled();
    });

    it('throws ForbiddenException when the sender is not a member', async () => {
      prismaMock.room.findUnique.mockResolvedValue(baseRoom);
      prismaMock.roomMember.findUnique.mockResolvedValue(null);

      await expect(
        service.createMessage('user-2', 'room-1', { content: 'hello' }),
      ).rejects.toThrow(ForbiddenException);
      expect(prismaMock.message.create).not.toHaveBeenCalled();
    });

    it('throws ForbiddenException when the sender already left the room', async () => {
      prismaMock.room.findUnique.mockResolvedValue(baseRoom);
      prismaMock.roomMember.findUnique.mockResolvedValue({
        id: 'member-1',
        roomId: 'room-1',
        userId: 'user-2',
        role: RoomRole.MEMBER,
        joinedAt: new Date(),
        leftAt: new Date(),
      });

      await expect(
        service.createMessage('user-2', 'room-1', { content: 'hello' }),
      ).rejects.toThrow(ForbiddenException);
      expect(prismaMock.message.create).not.toHaveBeenCalled();
    });
  });

  describe('getRoomMessages', () => {
    const activeMembership = {
      id: 'member-1',
      roomId: 'room-1',
      userId: 'user-2',
      role: RoomRole.MEMBER,
      joinedAt: new Date(),
      leftAt: null,
    };

    it('returns a paginated page of messages for an active member', async () => {
      prismaMock.room.findUnique.mockResolvedValue(baseRoom);
      prismaMock.roomMember.findUnique.mockResolvedValue(activeMembership);
      const messages = [
        { id: 'm2', roomId: 'room-1', userId: 'user-1', content: 'second' },
        { id: 'm1', roomId: 'room-1', userId: 'user-1', content: 'first' },
      ];
      prismaMock.message.findMany.mockResolvedValue(messages);
      prismaMock.message.count.mockResolvedValue(2);

      const result = await service.getRoomMessages('user-2', 'room-1', 1, 10);

      expect(prismaMock.message.findMany).toHaveBeenCalledWith({
        where: { roomId: 'room-1' },
        skip: 0,
        take: 10,
        orderBy: { createdAt: 'desc' },
      });
      expect(result).toEqual({
        items: messages,
        meta: {
          total: 2,
          page: 1,
          limit: 10,
          totalPages: 1,
          hasNextPage: false,
        },
      });
    });

    it('computes skip correctly for later pages', async () => {
      prismaMock.room.findUnique.mockResolvedValue(baseRoom);
      prismaMock.roomMember.findUnique.mockResolvedValue(activeMembership);
      prismaMock.message.findMany.mockResolvedValue([]);
      prismaMock.message.count.mockResolvedValue(25);

      const result = await service.getRoomMessages('user-2', 'room-1', 3, 10);

      expect(prismaMock.message.findMany).toHaveBeenCalledWith({
        where: { roomId: 'room-1' },
        skip: 20,
        take: 10,
        orderBy: { createdAt: 'desc' },
      });
      expect(result.meta).toEqual({
        total: 25,
        page: 3,
        limit: 10,
        totalPages: 3,
        hasNextPage: false,
      });
    });

    it('throws NotFoundException when the room does not exist', async () => {
      prismaMock.room.findUnique.mockResolvedValue(null);

      await expect(
        service.getRoomMessages('user-2', 'no-such-room'),
      ).rejects.toThrow(NotFoundException);
      expect(prismaMock.message.findMany).not.toHaveBeenCalled();
    });

    it('throws ForbiddenException when the requester is not a member', async () => {
      prismaMock.room.findUnique.mockResolvedValue(baseRoom);
      prismaMock.roomMember.findUnique.mockResolvedValue(null);

      await expect(service.getRoomMessages('user-2', 'room-1')).rejects.toThrow(
        ForbiddenException,
      );
      expect(prismaMock.message.findMany).not.toHaveBeenCalled();
    });
  });

  describe('addToQueue', () => {
    const activeMembership = {
      id: 'member-1',
      roomId: 'room-1',
      userId: 'user-2',
      role: RoomRole.MEMBER,
      joinedAt: new Date(),
      leftAt: null,
    };

    it('creates the queue entry when the caller is an active member and owns the track', async () => {
      prismaMock.room.findUnique.mockResolvedValue(baseRoom);
      prismaMock.roomMember.findUnique.mockResolvedValue(activeMembership);
      prismaMock.track.findUnique.mockResolvedValue({
        id: 'track-1',
        ownerId: 'user-2',
      });
      const entry = {
        id: 'entry-1',
        roomId: 'room-1',
        trackId: 'track-1',
        addedById: 'user-2',
      };
      prismaMock.roomQueueEntry.create.mockResolvedValue(entry);

      const result = await service.addToQueue('user-2', 'room-1', 'track-1');

      expect(prismaMock.roomQueueEntry.create).toHaveBeenCalledWith({
        data: { roomId: 'room-1', trackId: 'track-1', addedById: 'user-2' },
      });
      expect(result).toEqual(entry);
    });

    it('throws NotFoundException when the room does not exist', async () => {
      prismaMock.room.findUnique.mockResolvedValue(null);

      await expect(
        service.addToQueue('user-2', 'no-such-room', 'track-1'),
      ).rejects.toThrow(NotFoundException);
      expect(prismaMock.roomQueueEntry.create).not.toHaveBeenCalled();
    });

    it('throws ForbiddenException when the caller is not an active member', async () => {
      prismaMock.room.findUnique.mockResolvedValue(baseRoom);
      prismaMock.roomMember.findUnique.mockResolvedValue(null);

      await expect(
        service.addToQueue('user-2', 'room-1', 'track-1'),
      ).rejects.toThrow(ForbiddenException);
      expect(prismaMock.roomQueueEntry.create).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the track does not exist', async () => {
      prismaMock.room.findUnique.mockResolvedValue(baseRoom);
      prismaMock.roomMember.findUnique.mockResolvedValue(activeMembership);
      prismaMock.track.findUnique.mockResolvedValue(null);

      await expect(
        service.addToQueue('user-2', 'room-1', 'track-1'),
      ).rejects.toThrow(NotFoundException);
      expect(prismaMock.roomQueueEntry.create).not.toHaveBeenCalled();
    });

    it('throws ForbiddenException when the caller does not own the track', async () => {
      prismaMock.room.findUnique.mockResolvedValue(baseRoom);
      prismaMock.roomMember.findUnique.mockResolvedValue(activeMembership);
      prismaMock.track.findUnique.mockResolvedValue({
        id: 'track-1',
        ownerId: 'someone-else',
      });

      await expect(
        service.addToQueue('user-2', 'room-1', 'track-1'),
      ).rejects.toThrow(ForbiddenException);
      expect(prismaMock.roomQueueEntry.create).not.toHaveBeenCalled();
    });
  });

  describe('getRoomQueue', () => {
    const activeMembership = {
      id: 'member-1',
      roomId: 'room-1',
      userId: 'user-2',
      role: RoomRole.MEMBER,
      joinedAt: new Date(),
      leftAt: null,
    };

    it('returns the queue ordered by creation time, joined with track info', async () => {
      prismaMock.room.findUnique.mockResolvedValue(baseRoom);
      prismaMock.roomMember.findUnique.mockResolvedValue(activeMembership);
      const queue = [{ id: 'entry-1', roomId: 'room-1', trackId: 'track-1' }];
      prismaMock.roomQueueEntry.findMany.mockResolvedValue(queue);

      const result = await service.getRoomQueue('user-2', 'room-1');

      expect(prismaMock.roomQueueEntry.findMany).toHaveBeenCalledWith({
        where: { roomId: 'room-1' },
        orderBy: { createdAt: 'asc' },
        include: { track: true },
      });
      expect(result).toEqual(queue);
    });

    it('returns an empty array when nothing is queued, not a 404', async () => {
      prismaMock.room.findUnique.mockResolvedValue(baseRoom);
      prismaMock.roomMember.findUnique.mockResolvedValue(activeMembership);
      prismaMock.roomQueueEntry.findMany.mockResolvedValue([]);

      const result = await service.getRoomQueue('user-2', 'room-1');

      expect(result).toEqual([]);
    });

    it('throws NotFoundException when the room does not exist', async () => {
      prismaMock.room.findUnique.mockResolvedValue(null);

      await expect(
        service.getRoomQueue('user-2', 'no-such-room'),
      ).rejects.toThrow(NotFoundException);
      expect(prismaMock.roomQueueEntry.findMany).not.toHaveBeenCalled();
    });

    it('throws ForbiddenException when the caller is not an active member', async () => {
      prismaMock.room.findUnique.mockResolvedValue(baseRoom);
      prismaMock.roomMember.findUnique.mockResolvedValue(null);

      await expect(service.getRoomQueue('user-2', 'room-1')).rejects.toThrow(
        ForbiddenException,
      );
      expect(prismaMock.roomQueueEntry.findMany).not.toHaveBeenCalled();
    });
  });

  describe('deleteEntry', () => {
    const activeMembership = {
      id: 'member-1',
      roomId: 'room-1',
      userId: 'user-2',
      role: RoomRole.MEMBER,
      joinedAt: new Date(),
      leftAt: null,
    };
    const queueEntry = {
      id: 'entry-1',
      roomId: 'room-1',
      trackId: 'track-1',
      addedById: 'user-2',
    };

    it('deletes the entry when the caller is the one who added it', async () => {
      prismaMock.room.findUnique.mockResolvedValue(baseRoom); // hostId: user-1
      prismaMock.roomMember.findUnique.mockResolvedValue(activeMembership);
      prismaMock.roomQueueEntry.findUnique.mockResolvedValue(queueEntry);
      prismaMock.roomQueueEntry.delete.mockResolvedValue(queueEntry);

      const result = await service.deleteEntry('user-2', 'room-1', 'entry-1');

      expect(prismaMock.roomQueueEntry.delete).toHaveBeenCalledWith({
        where: { id: 'entry-1' },
      });
      expect(result).toEqual(queueEntry);
    });

    it('deletes the entry when the caller is the host, even if they did not add it', async () => {
      prismaMock.room.findUnique.mockResolvedValue(baseRoom); // hostId: user-1
      prismaMock.roomMember.findUnique.mockResolvedValue({
        ...activeMembership,
        userId: 'user-1',
        role: RoomRole.HOST,
      });
      prismaMock.roomQueueEntry.findUnique.mockResolvedValue(queueEntry); // addedById: user-2
      prismaMock.roomQueueEntry.delete.mockResolvedValue(queueEntry);

      await service.deleteEntry('user-1', 'room-1', 'entry-1');

      expect(prismaMock.roomQueueEntry.delete).toHaveBeenCalledWith({
        where: { id: 'entry-1' },
      });
    });

    it('throws ForbiddenException when the caller neither added the entry nor hosts the room', async () => {
      prismaMock.room.findUnique.mockResolvedValue(baseRoom); // hostId: user-1
      prismaMock.roomMember.findUnique.mockResolvedValue({
        ...activeMembership,
        userId: 'user-3',
      });
      prismaMock.roomQueueEntry.findUnique.mockResolvedValue(queueEntry); // addedById: user-2

      await expect(
        service.deleteEntry('user-3', 'room-1', 'entry-1'),
      ).rejects.toThrow(ForbiddenException);
      expect(prismaMock.roomQueueEntry.delete).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the entry does not exist', async () => {
      prismaMock.room.findUnique.mockResolvedValue(baseRoom);
      prismaMock.roomMember.findUnique.mockResolvedValue(activeMembership);
      prismaMock.roomQueueEntry.findUnique.mockResolvedValue(null);

      await expect(
        service.deleteEntry('user-2', 'room-1', 'entry-1'),
      ).rejects.toThrow(NotFoundException);
      expect(prismaMock.roomQueueEntry.delete).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the entry belongs to a different room', async () => {
      prismaMock.room.findUnique.mockResolvedValue(baseRoom);
      prismaMock.roomMember.findUnique.mockResolvedValue(activeMembership);
      prismaMock.roomQueueEntry.findUnique.mockResolvedValue({
        ...queueEntry,
        roomId: 'some-other-room',
      });

      await expect(
        service.deleteEntry('user-2', 'room-1', 'entry-1'),
      ).rejects.toThrow(NotFoundException);
      expect(prismaMock.roomQueueEntry.delete).not.toHaveBeenCalled();
    });

    it('throws ForbiddenException when the caller is not an active member', async () => {
      prismaMock.room.findUnique.mockResolvedValue(baseRoom);
      prismaMock.roomMember.findUnique.mockResolvedValue(null);

      await expect(
        service.deleteEntry('user-2', 'room-1', 'entry-1'),
      ).rejects.toThrow(ForbiddenException);
      expect(prismaMock.roomQueueEntry.delete).not.toHaveBeenCalled();
    });
  });
});
