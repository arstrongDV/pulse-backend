import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { PlaybackStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RoomsService } from '../rooms/rooms.service';

// Gives clients time to receive the broadcast before the scheduled
// moment arrives, so playback actually starts in sync instead of at
// whatever instant each client happens to process the message.
const SCHEDULE_BUFFER_MS = 300;

@Injectable()
export class PlaybackService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly roomsService: RoomsService,
  ) {}

  async play(
    hostId: string,
    roomId: string,
    trackId?: string,
    positionMs?: number,
  ) {
    await this.assertHost(hostId, roomId);

    const existing = await this.prisma.playbackState.findUnique({
      where: { roomId },
    });

    const resolvedTrackId = trackId ?? existing?.trackId;
    if (!resolvedTrackId) {
      throw new BadRequestException('No track to play — provide a trackId');
    }
    const resolvedPositionMs =
      positionMs ?? (trackId ? 0 : (existing?.positionMs ?? 0));

    const scheduledAt = new Date(Date.now() + SCHEDULE_BUFFER_MS);

    return this.prisma.playbackState.upsert({
      where: { roomId },
      create: {
        roomId,
        trackId: resolvedTrackId,
        status: PlaybackStatus.PLAYING,
        positionMs: resolvedPositionMs,
        scheduledAt,
      },
      update: {
        trackId: resolvedTrackId,
        status: PlaybackStatus.PLAYING,
        positionMs: resolvedPositionMs,
        scheduledAt,
      },
    });
  }

  async getState(roomId: string) {
    await this.roomsService.getRoomById(roomId); // 404s if the room doesn't exist

    const state = await this.prisma.playbackState.findUnique({
      where: { roomId },
    });

    return (
      state ?? {
        roomId,
        trackId: null,
        status: PlaybackStatus.STOPPED,
        positionMs: 0,
        scheduledAt: null,
      }
    );
  }

  async pause(hostId: string, roomId: string) {
    await this.assertHost(hostId, roomId);

    const existing = await this.prisma.playbackState.findUnique({
      where: { roomId },
    });

    if (!existing || existing.status !== PlaybackStatus.PLAYING) {
      throw new BadRequestException('Nothing is currently playing');
    }

    // Freeze at the REAL current position — not wherever it was when
    // play() last ran. scheduledAt + elapsed time tells us how far the
    // track has actually progressed since then.
    const elapsedMs = existing.scheduledAt
      ? Math.max(0, Date.now() - existing.scheduledAt.getTime())
      : 0;
    const currentPositionMs = existing.positionMs + elapsedMs;

    return this.prisma.playbackState.update({
      where: { roomId },
      data: {
        status: PlaybackStatus.PAUSED,
        positionMs: currentPositionMs,
        scheduledAt: null,
      },
    });
  }

  async seek(hostId: string, roomId: string, positionMs: number) {
    await this.assertHost(hostId, roomId);

    const existing = await this.prisma.playbackState.findUnique({
      where: { roomId },
    });

    if (!existing) {
      throw new BadRequestException('Nothing is currently playing');
    }

    // const seekMs = existing.scheduledAt ? existing.scheduledAt + seekTo + SCHEDULE_BUFFER_MS : 0;
    //seekTo - time where host scrolled
    const scheduledAt = new Date(Date.now() + SCHEDULE_BUFFER_MS);
    const resolvedPositionMs = positionMs ?? existing?.positionMs ?? 0;

    if (existing.status === PlaybackStatus.PLAYING) {
      return this.prisma.playbackState.update({
        where: { roomId },
        data: {
          status: PlaybackStatus.PLAYING,
          positionMs: resolvedPositionMs,
          scheduledAt,
        },
      });
    } else {
      return this.prisma.playbackState.update({
        where: { roomId },
        data: {
          status: PlaybackStatus.PAUSED,
          positionMs: resolvedPositionMs,
          scheduledAt: null,
        },
      });
    }
  }

  async skip(hostId: string, roomId: string, trackId: string) {
    await this.assertHost(hostId, roomId);

    const positionMs = 0;
    const scheduledAt = new Date(Date.now() + SCHEDULE_BUFFER_MS);

    return this.prisma.playbackState.upsert({
      where: { roomId },
      create: {
        roomId,
        trackId,
        status: PlaybackStatus.PLAYING,
        positionMs,
        scheduledAt,
      },
      update: {
        trackId,
        status: PlaybackStatus.PLAYING,
        positionMs,
        scheduledAt,
      },
    });
  }

  // Only checks hostId, not active membership. Safe only because
  // RoomsService.leaveRoom reassigns hostId to an active member whenever
  // the host leaves, so hostId can never point at a departed user. If
  // that host-handoff guarantee ever changes, this needs an explicit
  // isActiveMember check too.
  private async assertHost(userId: string, roomId: string) {
    const room = await this.roomsService.getRoomById(roomId);
    if (room.hostId !== userId) {
      throw new ForbiddenException('Only the host can control playback');
    }
  }
}
