import {
  ForbiddenException,
  Logger,
  UseFilters,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { JwtService } from '@nestjs/jwt';
import { Server, Socket } from 'socket.io';
import { requireEnv } from '../common/config/env';
import { PrismaService } from '../prisma/prisma.service';
import { RoomsService } from '../rooms/rooms.service';
import { PlaybackService } from '../playback/playback.service';
import { JoinRoomEventDto } from './dto/join-room-event.dto';
import { SendMessageEventDto } from './dto/send-message-event.dto';
import { PlayEventDto } from './dto/play-event.dto';
import { PauseEventDto } from './dto/pause-event.dto';
import { WsHttpExceptionFilter } from './filters/ws-exception.filter';
import { OnEvent } from '@nestjs/event-emitter';
import { Message } from '@prisma/client';
import { Throttle } from '@nestjs/throttler';
import { WsThrottlerGuard } from './guards/ws-throttler.guard';
import { SeekEventDto } from './dto/seek-event.dto';
import { SkipEventDto } from './dto/skip-event.dto';
import { MemberStatusEventDto } from './dto/member-status-event.dto';

interface JwtPayload {
  sub: string;
}

interface SocketData {
  userId: string;
}

type AuthenticatedSocket = Omit<Socket, 'data'> & { data: SocketData };

@WebSocketGateway()
@UsePipes(
  new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  }),
)
@UseFilters(new WsHttpExceptionFilter())
export class RealtimeGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(RealtimeGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
    private readonly roomsService: RoomsService,
    private readonly playbackService: PlaybackService,
  ) {}

  async handleConnection(client: AuthenticatedSocket) {
    try {
      const token = client.handshake.auth.token as string | undefined;
      if (!token) {
        throw new Error('No token provided');
      }

      const payload = await this.jwtService.verifyAsync<JwtPayload>(token, {
        secret: requireEnv('JWT_ACCESS_SECRET'),
      });

      client.data.userId = payload.sub;
      this.logger.log(`Client connected: ${client.id} (user ${payload.sub})`);
    } catch {
      this.logger.warn(`Rejected connection: ${client.id}`);
      client.disconnect();
    }
  }

  handleDisconnect(client: AuthenticatedSocket) {
    const userId = client.data.userId as string | undefined;

    if (userId) {
      for (const room of client.rooms) {
        client.to(room).emit('user_left', { userId });
      }
    }

    this.logger.log(`Client disconnected: ${client.id}`);
  }

  @SubscribeMessage('joinRoom')
  async handleJoinRoom(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: JoinRoomEventDto,
  ) {
    const userId = client.data.userId;

    if (!(await this.isActiveMember(data.roomId, userId))) {
      throw new ForbiddenException('Not a member of this room');
    }

    await client.join(data.roomId);
    client.to(data.roomId).emit('user_joined', { userId });
  }

  @OnEvent('message.create')
  handleMessageCreate({
    roomId,
    message,
  }: {
    roomId: string;
    message: Message;
  }) {
    this.server.to(roomId).emit('newMessage', {
      id: message.id,
      userId: message.userId,
      content: message.content,
      sentAt: message.createdAt.toISOString(),
    });
  }

  @Throttle({ default: { limit: 10, ttl: 10_000 } })
  @UseGuards(WsThrottlerGuard)
  @SubscribeMessage('sendMessage')
  async handleSendMessage(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: SendMessageEventDto,
  ) {
    await this.roomsService.createMessage(client.data.userId, data.roomId, {
      content: data.content,
    });
  }

  @Throttle({ default: { limit: 5, ttl: 5_000 } })
  @UseGuards(WsThrottlerGuard)
  @SubscribeMessage('play')
  async handlePlay(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: PlayEventDto,
  ) {
    const state = await this.playbackService.play(
      client.data.userId,
      data.roomId,
      data.trackId,
      data.positionMs,
    );

    this.server.to(data.roomId).emit('playbackStateChanged', {
      trackId: state.trackId,
      status: state.status,
      positionMs: state.positionMs,
      scheduledAt: state.scheduledAt?.toISOString() ?? null,
    });
  }

  @Throttle({ default: { limit: 5, ttl: 5_000 } })
  @UseGuards(WsThrottlerGuard)
  @SubscribeMessage('pause')
  async handlePause(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: PauseEventDto,
  ) {
    const state = await this.playbackService.pause(
      client.data.userId,
      data.roomId,
    );

    this.server.to(data.roomId).emit('playbackStateChanged', {
      trackId: state.trackId,
      status: state.status,
      positionMs: state.positionMs,
      scheduledAt: state.scheduledAt?.toISOString() ?? null,
    });
  }

  @Throttle({ default: { limit: 5, ttl: 5_000 } })
  @UseGuards(WsThrottlerGuard)
  @SubscribeMessage('seek')
  async seek(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: SeekEventDto,
  ) {
    const state = await this.playbackService.seek(
      client.data.userId,
      data.roomId,
      data.positionMs,
    );

    this.server.to(data.roomId).emit('playbackStateChanged', {
      trackId: state.trackId,
      status: state.status,
      positionMs: state.positionMs,
      scheduledAt: state.scheduledAt?.toISOString() ?? null,
    });
  }

  @Throttle({ default: { limit: 5, ttl: 5_000 } })
  @UseGuards(WsThrottlerGuard)
  @SubscribeMessage('skip')
  async skip(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: SkipEventDto,
  ) {
    const state = await this.playbackService.skip(
      client.data.userId,
      data.roomId,
      data.trackId,
    );

    this.server.to(data.roomId).emit('playbackStateChanged', {
      trackId: state.trackId,
      status: state.status,
      positionMs: state.positionMs,
      scheduledAt: state.scheduledAt?.toISOString() ?? null,
    });
  }

  @Throttle({ default: { limit: 5, ttl: 5_000 } })
  @UseGuards(WsThrottlerGuard)
  @SubscribeMessage('memberStatus')
  async handleMemberStatus(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: MemberStatusEventDto,
  ) {
    const userId = client.data.userId;

    if (!(await this.isActiveMember(data.roomId, userId))) {
      throw new ForbiddenException('Not a member of this room');
    }

    client.to(data.roomId).emit('memberStatusChanged', {
      userId,
      lagging: data.lagging,
    });
  }

  private async isActiveMember(roomId: string, userId: string) {
    const membership = await this.prisma.roomMember.findUnique({
      where: { roomId_userId: { roomId, userId } },
    });
    return !!membership && !membership.leftAt;
  }
}
