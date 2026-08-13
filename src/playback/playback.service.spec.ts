import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { PlaybackStatus } from '@prisma/client';
import { PlaybackService } from './playback.service';
import { PrismaService } from '../prisma/prisma.service';
import { RoomsService } from '../rooms/rooms.service';

describe('PlaybackService', () => {
  let service: PlaybackService;

  const prismaMock = {
    playbackState: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
      update: jest.fn(),
    },
  };
  const roomsServiceMock = {
    getRoomById: jest.fn(),
  };

  const baseRoom = {
    id: 'room-1',
    code: 'ABC123',
    hostId: 'user-1',
    name: 'My room',
    visibility: 'PUBLIC',
    maxParticipants: 5,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PlaybackService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: RoomsService, useValue: roomsServiceMock },
      ],
    }).compile();

    service = module.get<PlaybackService>(PlaybackService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('play', () => {
    it('starts a fresh track at position 0 when only trackId is given', async () => {
      roomsServiceMock.getRoomById.mockResolvedValue(baseRoom); // hostId: user-1
      prismaMock.playbackState.findUnique.mockResolvedValue(null);
      prismaMock.playbackState.upsert.mockResolvedValue({});

      await service.play('user-1', 'room-1', 'track-1');

      expect(prismaMock.playbackState.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { roomId: 'room-1' },
          create: expect.objectContaining({
            roomId: 'room-1',
            trackId: 'track-1',
            status: PlaybackStatus.PLAYING,
            positionMs: 0,
          }) as unknown,
        }),
      );
    });

    it('resumes the existing track and position when no trackId is given', async () => {
      roomsServiceMock.getRoomById.mockResolvedValue(baseRoom);
      prismaMock.playbackState.findUnique.mockResolvedValue({
        roomId: 'room-1',
        trackId: 'track-1',
        status: PlaybackStatus.PAUSED,
        positionMs: 42_000,
      });
      prismaMock.playbackState.upsert.mockResolvedValue({});

      await service.play('user-1', 'room-1');

      expect(prismaMock.playbackState.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({
            trackId: 'track-1',
            status: PlaybackStatus.PLAYING,
            positionMs: 42_000,
          }) as unknown,
        }),
      );
    });

    it('uses the given positionMs to seek while (re)starting playback', async () => {
      roomsServiceMock.getRoomById.mockResolvedValue(baseRoom);
      prismaMock.playbackState.findUnique.mockResolvedValue({
        roomId: 'room-1',
        trackId: 'track-1',
        status: PlaybackStatus.PAUSED,
        positionMs: 42_000,
      });
      prismaMock.playbackState.upsert.mockResolvedValue({});

      await service.play('user-1', 'room-1', undefined, 5_000);

      expect(prismaMock.playbackState.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({ positionMs: 5_000 }) as unknown,
        }),
      );
    });

    it('throws BadRequestException when resuming with no prior track', async () => {
      roomsServiceMock.getRoomById.mockResolvedValue(baseRoom);
      prismaMock.playbackState.findUnique.mockResolvedValue(null);

      await expect(service.play('user-1', 'room-1')).rejects.toThrow(
        BadRequestException,
      );
      expect(prismaMock.playbackState.upsert).not.toHaveBeenCalled();
    });

    it('throws ForbiddenException when the caller is not the host', async () => {
      roomsServiceMock.getRoomById.mockResolvedValue(baseRoom); // hostId: user-1

      await expect(service.play('user-2', 'room-1', 'track-1')).rejects.toThrow(
        ForbiddenException,
      );
      expect(prismaMock.playbackState.upsert).not.toHaveBeenCalled();
    });
  });

  describe('getState', () => {
    it('returns the persisted state when one exists', async () => {
      roomsServiceMock.getRoomById.mockResolvedValue(baseRoom);
      const state = {
        roomId: 'room-1',
        trackId: 'track-1',
        status: PlaybackStatus.PLAYING,
        positionMs: 1000,
        scheduledAt: new Date(),
      };
      prismaMock.playbackState.findUnique.mockResolvedValue(state);

      await expect(service.getState('room-1')).resolves.toEqual(state);
    });

    it('returns a default STOPPED state when nothing has ever been played', async () => {
      roomsServiceMock.getRoomById.mockResolvedValue(baseRoom);
      prismaMock.playbackState.findUnique.mockResolvedValue(null);

      const result = await service.getState('room-1');

      expect(result).toEqual({
        roomId: 'room-1',
        trackId: null,
        status: PlaybackStatus.STOPPED,
        positionMs: 0,
        scheduledAt: null,
      });
    });
  });

  describe('pause', () => {
    beforeEach(() => {
      jest.useFakeTimers().setSystemTime(new Date('2026-01-01T00:00:10.000Z'));
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('freezes at the real elapsed position, not the stored one', async () => {
      roomsServiceMock.getRoomById.mockResolvedValue(baseRoom); // hostId: user-1
      prismaMock.playbackState.findUnique.mockResolvedValue({
        roomId: 'room-1',
        trackId: 'track-1',
        status: PlaybackStatus.PLAYING,
        positionMs: 2_000, // where it was when play() last ran
        scheduledAt: new Date('2026-01-01T00:00:05.000Z'), // 5s ago
      });
      prismaMock.playbackState.update.mockResolvedValue({});

      await service.pause('user-1', 'room-1');

      // 5s stored + 5s elapsed since scheduledAt = 10s, not the stored 2s
      expect(prismaMock.playbackState.update).toHaveBeenCalledWith({
        where: { roomId: 'room-1' },
        data: {
          status: PlaybackStatus.PAUSED,
          positionMs: 7_000,
          scheduledAt: null,
        },
      });
    });

    it('does not go negative when paused before the scheduled start', async () => {
      roomsServiceMock.getRoomById.mockResolvedValue(baseRoom);
      prismaMock.playbackState.findUnique.mockResolvedValue({
        roomId: 'room-1',
        trackId: 'track-1',
        status: PlaybackStatus.PLAYING,
        positionMs: 2_000,
        scheduledAt: new Date('2026-01-01T00:00:20.000Z'), // still in the future
      });
      prismaMock.playbackState.update.mockResolvedValue({});

      await service.pause('user-1', 'room-1');

      expect(prismaMock.playbackState.update).toHaveBeenCalledWith({
        where: { roomId: 'room-1' },
        data: {
          status: PlaybackStatus.PAUSED,
          positionMs: 2_000,
          scheduledAt: null,
        },
      });
    });

    it('throws BadRequestException when nothing is playing', async () => {
      roomsServiceMock.getRoomById.mockResolvedValue(baseRoom);
      prismaMock.playbackState.findUnique.mockResolvedValue(null);

      await expect(service.pause('user-1', 'room-1')).rejects.toThrow(
        BadRequestException,
      );
      expect(prismaMock.playbackState.update).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when already paused', async () => {
      roomsServiceMock.getRoomById.mockResolvedValue(baseRoom);
      prismaMock.playbackState.findUnique.mockResolvedValue({
        roomId: 'room-1',
        trackId: 'track-1',
        status: PlaybackStatus.PAUSED,
        positionMs: 2_000,
        scheduledAt: null,
      });

      await expect(service.pause('user-1', 'room-1')).rejects.toThrow(
        BadRequestException,
      );
      expect(prismaMock.playbackState.update).not.toHaveBeenCalled();
    });

    it('throws ForbiddenException when the caller is not the host', async () => {
      roomsServiceMock.getRoomById.mockResolvedValue(baseRoom); // hostId: user-1

      await expect(service.pause('user-2', 'room-1')).rejects.toThrow(
        ForbiddenException,
      );
      expect(prismaMock.playbackState.update).not.toHaveBeenCalled();
    });
  });

  describe('seek', () => {
    it('schedules a fresh start at the new position while playing', async () => {
      roomsServiceMock.getRoomById.mockResolvedValue(baseRoom); // hostId: user-1
      prismaMock.playbackState.findUnique.mockResolvedValue({
        roomId: 'room-1',
        trackId: 'track-1',
        status: PlaybackStatus.PLAYING,
        positionMs: 2_000,
        scheduledAt: new Date(),
      });
      prismaMock.playbackState.update.mockResolvedValue({});

      await service.seek('user-1', 'room-1', 90_000);

      expect(prismaMock.playbackState.update).toHaveBeenCalledWith({
        where: { roomId: 'room-1' },
        data: {
          status: PlaybackStatus.PLAYING,
          positionMs: 90_000,
          scheduledAt: expect.any(Date) as Date,
        },
      });
    });

    it('just moves the position and stays paused while paused', async () => {
      roomsServiceMock.getRoomById.mockResolvedValue(baseRoom);
      prismaMock.playbackState.findUnique.mockResolvedValue({
        roomId: 'room-1',
        trackId: 'track-1',
        status: PlaybackStatus.PAUSED,
        positionMs: 2_000,
        scheduledAt: null,
      });
      prismaMock.playbackState.update.mockResolvedValue({});

      await service.seek('user-1', 'room-1', 90_000);

      expect(prismaMock.playbackState.update).toHaveBeenCalledWith({
        where: { roomId: 'room-1' },
        data: {
          status: PlaybackStatus.PAUSED,
          positionMs: 90_000,
          scheduledAt: null,
        },
      });
    });

    it('throws BadRequestException when nothing has ever been loaded', async () => {
      roomsServiceMock.getRoomById.mockResolvedValue(baseRoom);
      prismaMock.playbackState.findUnique.mockResolvedValue(null);

      await expect(service.seek('user-1', 'room-1', 90_000)).rejects.toThrow(
        BadRequestException,
      );
      expect(prismaMock.playbackState.update).not.toHaveBeenCalled();
    });

    it('throws ForbiddenException when the caller is not the host', async () => {
      roomsServiceMock.getRoomById.mockResolvedValue(baseRoom); // hostId: user-1

      await expect(service.seek('user-2', 'room-1', 90_000)).rejects.toThrow(
        ForbiddenException,
      );
      expect(prismaMock.playbackState.update).not.toHaveBeenCalled();
    });
  });

  describe('skip', () => {
    it('switches to the new track at position 0 and schedules playback', async () => {
      roomsServiceMock.getRoomById.mockResolvedValue(baseRoom); // hostId: user-1
      prismaMock.playbackState.findUnique.mockResolvedValue({
        roomId: 'room-1',
        trackId: 'track-1',
        status: PlaybackStatus.PLAYING,
        positionMs: 42_000,
        scheduledAt: new Date(),
      });
      prismaMock.playbackState.upsert.mockResolvedValue({});

      await service.skip('user-1', 'room-1', 'track-2');

      expect(prismaMock.playbackState.upsert).toHaveBeenCalledWith({
        where: { roomId: 'room-1' },
        create: {
          roomId: 'room-1',
          trackId: 'track-2',
          status: PlaybackStatus.PLAYING,
          positionMs: 0,
          scheduledAt: expect.any(Date) as Date,
        },
        update: {
          trackId: 'track-2',
          status: PlaybackStatus.PLAYING,
          positionMs: 0,
          scheduledAt: expect.any(Date) as Date,
        },
      });
    });

    it('works as the first playback action in a room with no prior state', async () => {
      roomsServiceMock.getRoomById.mockResolvedValue(baseRoom);
      prismaMock.playbackState.findUnique.mockResolvedValue(null);
      prismaMock.playbackState.upsert.mockResolvedValue({});

      await service.skip('user-1', 'room-1', 'track-1');

      expect(prismaMock.playbackState.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            trackId: 'track-1',
            status: PlaybackStatus.PLAYING,
            positionMs: 0,
          }) as unknown,
        }),
      );
    });

    it('throws ForbiddenException when the caller is not the host', async () => {
      roomsServiceMock.getRoomById.mockResolvedValue(baseRoom); // hostId: user-1

      await expect(service.skip('user-2', 'room-1', 'track-2')).rejects.toThrow(
        ForbiddenException,
      );
      expect(prismaMock.playbackState.upsert).not.toHaveBeenCalled();
    });
  });
});
