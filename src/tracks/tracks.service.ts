import { randomUUID } from 'crypto';
import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { InitUploadPayloadDto } from './dto/init-upload.dto';
import { CompleteUploadPayloadDto } from './dto/complete-upload.dto';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';

export interface TrackData {
  id: string;
  ownerId: string;
  title: string;
  storageKey: string;
  durationMs: number;
  mimeType: string;
  size: number;
  createdAt: Date;
}

export interface TrackDownloadData extends TrackData {
  url: string;
}

// Well under the presigned URL's own 1-hour validity — long enough to
// actually avoid repeated authorization checks + R2 signing calls for a
// client re-fetching the same track's URL.
const TRACK_DOWNLOAD_CACHE_TTL_MS = 5 * 60 * 1_000;

@Injectable()
export class TracksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storageService: StorageService,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
  ) {}

  async initUpload(userId: string, payload: InitUploadPayloadDto) {
    const extension = this.getSafeExtension(payload.filename);
    const key = `tracks/${userId}/${randomUUID()}.${extension}`;

    const uploadUrl = await this.storageService.createUploadUrl(
      key,
      payload.contentType,
    );

    return { uploadUrl, key };
  }

  async completeUpload(userId: string, payload: CompleteUploadPayloadDto) {
    if (!payload.key.startsWith(`tracks/${userId}/`)) {
      throw new ForbiddenException('This upload key does not belong to you');
    }

    const existing = await this.prisma.track.findUnique({
      where: { storageKey: payload.key },
    });
    if (existing) {
      throw new BadRequestException('This upload has already been completed');
    }

    const object = await this.storageService.headObject(payload.key);
    if (!object) {
      throw new BadRequestException(
        'Upload not found — finish the direct upload to R2 first',
      );
    }

    return this.prisma.track.create({
      data: {
        ownerId: userId,
        title: payload.title,
        storageKey: payload.key,
        durationMs: payload.durationMs,
        mimeType: object.contentType ?? 'application/octet-stream',
        size: object.size,
      },
    });
  }

  async getDownloadUrl(userId: string, trackId: string) {
    const cacheKey = this.trackKey(trackId, userId);
    const cached = await this.cache.get<TrackDownloadData>(cacheKey);
    if (cached) {
      return cached;
    }

    const track = await this.prisma.track.findUnique({
      where: { id: trackId },
    });
    if (!track) {
      throw new NotFoundException('Track not found');
    }

    if (track.ownerId !== userId) {
      const queuedInMemberRoom = await this.prisma.roomQueueEntry.findFirst({
        where: {
          trackId,
          room: { members: { some: { userId, leftAt: null } } },
        },
      });
      if (!queuedInMemberRoom) {
        throw new ForbiddenException('You do not have access to this track');
      }
    }

    const url = await this.storageService.createDownloadUrl(track.storageKey);
    const result = { ...track, url };
    await this.cache.set(cacheKey, result, TRACK_DOWNLOAD_CACHE_TTL_MS);

    return result;
  }

  private getSafeExtension(filename: string): string {
    const match = /\.([a-zA-Z0-9]+)$/.exec(filename);
    return match ? match[1].toLowerCase() : 'bin';
  }

  private trackKey(trackId: string, userId: string) {
    return `track:${trackId}:${userId}`;
  }
}
