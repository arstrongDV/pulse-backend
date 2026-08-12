import { Test, TestingModule } from '@nestjs/testing';
import { Prisma, RoomRole, RoomVisibility } from '@prisma/client';
import * as argon2 from 'argon2';
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
      ],
    }).compile();

    service = module.get<RoomsService>(RoomsService);

    jest.clearAllMocks();
    prismaMock.$transaction.mockImplementation(
      (callback: (tx: typeof txMock) => unknown) => callback(txMock),
    );
    prismaMock.roomMember.count.mockResolvedValue(1);
    prismaMock.roomMember.findUnique.mockResolvedValue(null);
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
});
