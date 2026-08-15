import { randomUUID } from 'crypto';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { InitUploadPayloadDto } from './dto/init-upload.dto';
import { CompleteUploadPayloadDto } from './dto/complete-upload.dto';

@Injectable()
export class TracksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storageService: StorageService,
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
    return { ...track, url };
  }

  private getSafeExtension(filename: string): string {
    const match = /\.([a-zA-Z0-9]+)$/.exec(filename);
    return match ? match[1].toLowerCase() : 'bin';
  }
}
