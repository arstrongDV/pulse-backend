import { Logger } from '@nestjs/common';
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

interface JwtPayload {
  sub: string;
}

interface SocketData {
  userId: string;
}

type AuthenticatedSocket = Omit<Socket, 'data'> & { data: SocketData };

@WebSocketGateway()
export class RealtimeGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(RealtimeGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
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
    @MessageBody() data: { roomId: string },
  ) {
    const userId = client.data.userId;

    if (!(await this.isActiveMember(data.roomId, userId))) {
      client.emit('error', { message: 'Not a member of this room' });
      return;
    }

    await client.join(data.roomId);
    client.to(data.roomId).emit('user_joined', { userId });
  }

  @SubscribeMessage('sendMessage')
  async handleSendMessage(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { roomId: string; content: string },
  ) {
    const userId = client.data.userId;

    if (!(await this.isActiveMember(data.roomId, userId))) {
      client.emit('error', { message: 'Not a member of this room' });
      return;
    }

    const message = await this.prisma.message.create({
      data: {
        roomId: data.roomId,
        userId,
        content: data.content,
      },
    });

    this.server.to(data.roomId).emit('newMessage', {
      id: message.id,
      userId: message.userId,
      content: message.content,
      sentAt: message.createdAt.toISOString(),
    });
  }

  private async isActiveMember(roomId: string, userId: string) {
    const membership = await this.prisma.roomMember.findUnique({
      where: { roomId_userId: { roomId, userId } },
    });
    return !!membership && !membership.leftAt;
  }
}
