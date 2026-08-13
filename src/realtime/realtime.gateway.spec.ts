import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { RealtimeGateway } from './realtime.gateway';
import { PrismaService } from '../prisma/prisma.service';
import { RoomsService } from '../rooms/rooms.service';
import { PlaybackService } from '../playback/playback.service';
import { WsThrottlerGuard } from './guards/ws-throttler.guard';

describe('RealtimeGateway', () => {
  let gateway: RealtimeGateway;

  const jwtServiceMock = { verifyAsync: jest.fn() };
  const prismaMock = { roomMember: { findUnique: jest.fn() } };
  const roomsServiceMock = { createMessage: jest.fn() };
  const playbackServiceMock = {
    play: jest.fn(),
    pause: jest.fn(),
    seek: jest.fn(),
    skip: jest.fn(),
  };
  const serverMock = { to: jest.fn().mockReturnThis(), emit: jest.fn() };

  const makeClient = (overrides: Record<string, unknown> = {}) => ({
    id: 'socket-1',
    data: { userId: 'user-1' },
    handshake: { auth: {} },
    rooms: new Set<string>(),
    join: jest.fn(),
    to: jest.fn().mockReturnThis(),
    emit: jest.fn(),
    disconnect: jest.fn(),
    ...overrides,
  });

  beforeAll(() => {
    process.env.JWT_ACCESS_SECRET = 'test-secret';
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RealtimeGateway,
        { provide: JwtService, useValue: jwtServiceMock },
        { provide: PrismaService, useValue: prismaMock },
        { provide: RoomsService, useValue: roomsServiceMock },
        { provide: PlaybackService, useValue: playbackServiceMock },
      ],
    })
      .overrideGuard(WsThrottlerGuard)
      .useValue({ canActivate: () => true })
      .compile();

    gateway = module.get<RealtimeGateway>(RealtimeGateway);
    gateway.server = serverMock as never;
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(gateway).toBeDefined();
  });

  describe('handleConnection', () => {
    it('authenticates and stores userId on the socket when the token is valid', async () => {
      const client = makeClient({
        data: {},
        handshake: { auth: { token: 'good-token' } },
      });
      jwtServiceMock.verifyAsync.mockResolvedValue({ sub: 'user-1' });

      await gateway.handleConnection(client as never);

      expect(client.data.userId).toBe('user-1');
      expect(client.disconnect).not.toHaveBeenCalled();
    });

    it('disconnects the client when no token is provided', async () => {
      const client = makeClient({ handshake: { auth: {} } });

      await gateway.handleConnection(client as never);

      expect(client.disconnect).toHaveBeenCalled();
    });

    it('disconnects the client when the token fails verification', async () => {
      const client = makeClient({
        handshake: { auth: { token: 'bad-token' } },
      });
      jwtServiceMock.verifyAsync.mockRejectedValue(new Error('invalid'));

      await gateway.handleConnection(client as never);

      expect(client.disconnect).toHaveBeenCalled();
    });
  });

  describe('handleDisconnect', () => {
    it('notifies every room the client was in that the user left', () => {
      const client = makeClient({ rooms: new Set(['socket-1', 'room-1']) });

      gateway.handleDisconnect(client as never);

      expect(client.to).toHaveBeenCalledWith('room-1');
      expect(client.emit).toHaveBeenCalledWith('user_left', {
        userId: 'user-1',
      });
    });
  });

  describe('handleJoinRoom', () => {
    it('joins the socket room and notifies others when the caller is an active member', async () => {
      const client = makeClient();
      prismaMock.roomMember.findUnique.mockResolvedValue({ leftAt: null });

      await gateway.handleJoinRoom(client as never, { roomId: 'room-1' });

      expect(client.join).toHaveBeenCalledWith('room-1');
      expect(client.to).toHaveBeenCalledWith('room-1');
      expect(client.emit).toHaveBeenCalledWith('user_joined', {
        userId: 'user-1',
      });
    });

    it('throws ForbiddenException when the caller is not an active member', async () => {
      const client = makeClient();
      prismaMock.roomMember.findUnique.mockResolvedValue(null);

      await expect(
        gateway.handleJoinRoom(client as never, { roomId: 'room-1' }),
      ).rejects.toThrow(ForbiddenException);
      expect(client.join).not.toHaveBeenCalled();
    });
  });

  describe('handleSendMessage', () => {
    it('delegates to RoomsService.createMessage', async () => {
      const client = makeClient();

      await gateway.handleSendMessage(client as never, {
        roomId: 'room-1',
        content: 'hi',
      });

      expect(roomsServiceMock.createMessage).toHaveBeenCalledWith(
        'user-1',
        'room-1',
        { content: 'hi' },
      );
    });
  });

  describe('handleMessageCreate', () => {
    it('broadcasts newMessage to the room', () => {
      const message = {
        id: 'msg-1',
        userId: 'user-1',
        content: 'hi',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      };

      gateway.handleMessageCreate({
        roomId: 'room-1',
        message: message as never,
      });

      expect(serverMock.to).toHaveBeenCalledWith('room-1');
      expect(serverMock.emit).toHaveBeenCalledWith('newMessage', {
        id: 'msg-1',
        userId: 'user-1',
        content: 'hi',
        sentAt: '2026-01-01T00:00:00.000Z',
      });
    });
  });

  describe('playback handlers', () => {
    const state = {
      trackId: 'track-1',
      status: 'PLAYING',
      positionMs: 1000,
      scheduledAt: new Date('2026-01-01T00:00:00.000Z'),
    };

    it('handlePlay delegates to PlaybackService and broadcasts playbackStateChanged', async () => {
      const client = makeClient();
      playbackServiceMock.play.mockResolvedValue(state);

      await gateway.handlePlay(client as never, {
        roomId: 'room-1',
        trackId: 'track-1',
      });

      expect(playbackServiceMock.play).toHaveBeenCalledWith(
        'user-1',
        'room-1',
        'track-1',
        undefined,
      );
      expect(serverMock.to).toHaveBeenCalledWith('room-1');
      expect(serverMock.emit).toHaveBeenCalledWith('playbackStateChanged', {
        trackId: 'track-1',
        status: 'PLAYING',
        positionMs: 1000,
        scheduledAt: '2026-01-01T00:00:00.000Z',
      });
    });

    it('handlePause delegates to PlaybackService and broadcasts playbackStateChanged', async () => {
      const client = makeClient();
      playbackServiceMock.pause.mockResolvedValue(state);

      await gateway.handlePause(client as never, { roomId: 'room-1' });

      expect(playbackServiceMock.pause).toHaveBeenCalledWith(
        'user-1',
        'room-1',
      );
      expect(serverMock.emit).toHaveBeenCalledWith(
        'playbackStateChanged',
        expect.any(Object),
      );
    });

    it('seek delegates to PlaybackService and broadcasts playbackStateChanged', async () => {
      const client = makeClient();
      playbackServiceMock.seek.mockResolvedValue(state);

      await gateway.seek(client as never, {
        roomId: 'room-1',
        positionMs: 90_000,
      });

      expect(playbackServiceMock.seek).toHaveBeenCalledWith(
        'user-1',
        'room-1',
        90_000,
      );
      expect(serverMock.emit).toHaveBeenCalledWith(
        'playbackStateChanged',
        expect.any(Object),
      );
    });

    it('skip delegates to PlaybackService and broadcasts playbackStateChanged', async () => {
      const client = makeClient();
      playbackServiceMock.skip.mockResolvedValue(state);

      await gateway.skip(client as never, {
        roomId: 'room-1',
        trackId: 'track-2',
      });

      expect(playbackServiceMock.skip).toHaveBeenCalledWith(
        'user-1',
        'room-1',
        'track-2',
      );
      expect(serverMock.emit).toHaveBeenCalledWith(
        'playbackStateChanged',
        expect.any(Object),
      );
    });
  });

  describe('handleMemberStatus', () => {
    it('relays the status to the room without echoing it back to the sender', async () => {
      const client = makeClient();
      prismaMock.roomMember.findUnique.mockResolvedValue({ leftAt: null });

      await gateway.handleMemberStatus(client as never, {
        roomId: 'room-1',
        lagging: true,
      });

      expect(client.to).toHaveBeenCalledWith('room-1');
      expect(client.emit).toHaveBeenCalledWith('memberStatusChanged', {
        userId: 'user-1',
        lagging: true,
      });
      expect(serverMock.emit).not.toHaveBeenCalled();
    });

    it('throws ForbiddenException when the caller is not an active member', async () => {
      const client = makeClient();
      prismaMock.roomMember.findUnique.mockResolvedValue(null);

      await expect(
        gateway.handleMemberStatus(client as never, {
          roomId: 'room-1',
          lagging: true,
        }),
      ).rejects.toThrow(ForbiddenException);
      expect(client.emit).not.toHaveBeenCalled();
    });
  });
});
