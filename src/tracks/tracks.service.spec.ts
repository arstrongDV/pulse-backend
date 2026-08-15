import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { TracksService } from './tracks.service';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';

describe('TracksService', () => {
  let service: TracksService;

  const prismaMock = {
    track: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
    roomQueueEntry: {
      findFirst: jest.fn(),
      create: jest.fn(),
    },
  };
  const storageServiceMock = {
    createUploadUrl: jest.fn(),
    createDownloadUrl: jest.fn(),
    headObject: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TracksService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: StorageService, useValue: storageServiceMock },
      ],
    }).compile();

    service = module.get<TracksService>(TracksService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('initUpload', () => {
    it('generates a key scoped to the user with the filename extension, and returns the presigned url', async () => {
      storageServiceMock.createUploadUrl.mockResolvedValue(
        'https://signed-put-url',
      );

      const result = await service.initUpload('user-1', {
        filename: 'my track.mp3',
        contentType: 'audio/mpeg',
        size: 1000,
      });

      expect(result.uploadUrl).toBe('https://signed-put-url');
      expect(result.key).toMatch(/^tracks\/user-1\/[0-9a-f-]{36}\.mp3$/);
      expect(storageServiceMock.createUploadUrl).toHaveBeenCalledWith(
        result.key,
        'audio/mpeg',
      );
    });

    it('falls back to a generic extension when the filename has none', async () => {
      storageServiceMock.createUploadUrl.mockResolvedValue(
        'https://signed-put-url',
      );

      const result = await service.initUpload('user-1', {
        filename: 'noextension',
        contentType: 'audio/mpeg',
        size: 1000,
      });

      expect(result.key).toMatch(/^tracks\/user-1\/[0-9a-f-]{36}\.bin$/);
    });
  });

  describe('completeUpload', () => {
    const payload = {
      key: 'tracks/user-1/abc.mp3',
      title: 'My track',
      durationMs: 180_000,
    };

    it('creates the Track row using metadata read back from R2', async () => {
      prismaMock.track.findUnique.mockResolvedValue(null);
      storageServiceMock.headObject.mockResolvedValue({
        contentType: 'audio/mpeg',
        size: 5000,
      });
      prismaMock.track.create.mockResolvedValue({ id: 'track-1' });

      const result = await service.completeUpload('user-1', payload);

      expect(result).toEqual({ id: 'track-1' });
      expect(prismaMock.track.create).toHaveBeenCalledWith({
        data: {
          ownerId: 'user-1',
          title: 'My track',
          storageKey: 'tracks/user-1/abc.mp3',
          durationMs: 180_000,
          mimeType: 'audio/mpeg',
          size: 5000,
        },
      });
    });

    it('throws ForbiddenException when the key does not belong to the caller', async () => {
      await expect(service.completeUpload('user-2', payload)).rejects.toThrow(
        ForbiddenException,
      );
      expect(storageServiceMock.headObject).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when the upload was already completed', async () => {
      prismaMock.track.findUnique.mockResolvedValue({ id: 'existing' });

      await expect(service.completeUpload('user-1', payload)).rejects.toThrow(
        BadRequestException,
      );
      expect(storageServiceMock.headObject).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when the object was never uploaded to R2', async () => {
      prismaMock.track.findUnique.mockResolvedValue(null);
      storageServiceMock.headObject.mockResolvedValue(null);

      await expect(service.completeUpload('user-1', payload)).rejects.toThrow(
        BadRequestException,
      );
      expect(prismaMock.track.create).not.toHaveBeenCalled();
    });
  });

  describe('getDownloadUrl', () => {
    it('returns the track with a signed download url when the caller owns it', async () => {
      prismaMock.track.findUnique.mockResolvedValue({
        id: 'track-1',
        ownerId: 'user-1',
        storageKey: 'tracks/user-1/abc.mp3',
      });
      storageServiceMock.createDownloadUrl.mockResolvedValue(
        'https://signed-get-url',
      );

      const result = await service.getDownloadUrl('user-1', 'track-1');

      expect(result).toEqual({
        id: 'track-1',
        ownerId: 'user-1',
        storageKey: 'tracks/user-1/abc.mp3',
        url: 'https://signed-get-url',
      });
    });

    it('throws NotFoundException when the track does not exist', async () => {
      prismaMock.track.findUnique.mockResolvedValue(null);

      await expect(service.getDownloadUrl('user-1', 'track-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws ForbiddenException when the caller does not own the track and it is not queued in any of their rooms', async () => {
      prismaMock.track.findUnique.mockResolvedValue({
        id: 'track-1',
        ownerId: 'user-2',
        storageKey: 'tracks/user-2/abc.mp3',
      });
      prismaMock.roomQueueEntry.findFirst.mockResolvedValue(null);

      await expect(service.getDownloadUrl('user-1', 'track-1')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('returns the track with a signed download url when the caller does not own it but it is queued in a room they are an active member of', async () => {
      prismaMock.track.findUnique.mockResolvedValue({
        id: 'track-1',
        ownerId: 'user-2',
        storageKey: 'tracks/user-2/abc.mp3',
      });
      prismaMock.roomQueueEntry.findFirst.mockResolvedValue({
        id: 'entry-1',
      });
      storageServiceMock.createDownloadUrl.mockResolvedValue(
        'https://signed-get-url',
      );

      const result = await service.getDownloadUrl('user-1', 'track-1');

      expect(result).toEqual({
        id: 'track-1',
        ownerId: 'user-2',
        storageKey: 'tracks/user-2/abc.mp3',
        url: 'https://signed-get-url',
      });
      expect(prismaMock.roomQueueEntry.findFirst).toHaveBeenCalledWith({
        where: {
          trackId: 'track-1',
          room: { members: { some: { userId: 'user-1', leftAt: null } } },
        },
      });
    });
  });
});
