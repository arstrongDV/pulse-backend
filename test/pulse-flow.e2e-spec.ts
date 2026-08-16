import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';

interface AuthResponseBody {
  user: { id: string };
  accessToken: string;
}
interface RoomResponseBody {
  id: string;
  code: string;
}
interface PlaybackResponseBody {
  status: string;
  trackId: string;
}
interface UserResponseBody {
  id: string;
}
interface QueueEntryResponseBody {
  trackId: string;
}

describe('Pulse core flow (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  let hostToken: string;
  let hostUserId: string;
  let memberToken: string;
  let roomId: string;
  let roomCode: string;
  let trackId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    // main.ts's bootstrap() never runs here, so its global setup has to be
    // reapplied by hand — otherwise this app instance validates requests
    // more loosely than production actually does.
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  it('registers the host', async () => {
    const suffix = Date.now();
    const res = await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        email: `e2e-host-${suffix}@test.com`,
        username: `e2ehost${suffix}`,
        password: 'Password123!',
      })
      .expect(201);

    const body = res.body as AuthResponseBody;
    hostToken = body.accessToken;
    hostUserId = body.user.id;
    expect(hostToken).toBeDefined();
  });

  it('creates a room and returns a joinable code', async () => {
    const res = await request(app.getHttpServer())
      .post('/rooms')
      .set('Authorization', `Bearer ${hostToken}`)
      .send({ visibility: 'PUBLIC', maxParticipants: 5 })
      .expect(201);

    const body = res.body as RoomResponseBody;
    roomId = body.id;
    roomCode = body.code;
    expect(roomId).toBeDefined();
    expect(roomCode).toBeDefined();
  });

  it('a second user registers and joins by code', async () => {
    const suffix = Date.now();
    const res = await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        email: `e2e-member-${suffix}@test.com`,
        username: `e2emember${suffix}`,
        password: 'Password123!',
      })
      .expect(201);
    memberToken = (res.body as AuthResponseBody).accessToken;

    await request(app.getHttpServer())
      .post('/rooms/join')
      .set('Authorization', `Bearer ${memberToken}`)
      .send({ code: roomCode })
      .expect(201);
  });

  it('the host plays a track', async () => {
    // Bypasses the real upload flow deliberately — storage/R2 already has
    // its own dedicated coverage. This test's job is proving the
    // room/playback/queue flow works together, not re-proving storage.
    const track = await prisma.track.create({
      data: {
        ownerId: hostUserId,
        title: 'E2E test track',
        storageKey: `tracks/e2e/${Date.now()}.mp3`,
        durationMs: 180_000,
        mimeType: 'audio/mpeg',
        size: 1000,
      },
    });
    trackId = track.id;

    const res = await request(app.getHttpServer())
      .post(`/rooms/${roomId}/playback/play`)
      .set('Authorization', `Bearer ${hostToken}`)
      .send({ trackId })
      .expect(201);

    const body = res.body as PlaybackResponseBody;
    expect(body.status).toBe('PLAYING');
    expect(body.trackId).toBe(trackId);
  });

  it('rejects the member trying to control playback', async () => {
    await request(app.getHttpServer())
      .post(`/rooms/${roomId}/playback/pause`)
      .set('Authorization', `Bearer ${memberToken}`)
      .expect(403);
  });

  it('the member queues their own track', async () => {
    const memberProfile = await request(app.getHttpServer())
      .get('/users/me')
      .set('Authorization', `Bearer ${memberToken}`)
      .expect(200);
    const memberUserId = (memberProfile.body as UserResponseBody).id;

    const memberTrack = await prisma.track.create({
      data: {
        ownerId: memberUserId,
        title: 'Member track',
        storageKey: `tracks/e2e/${Date.now()}-member.mp3`,
        durationMs: 120_000,
        mimeType: 'audio/mpeg',
        size: 800,
      },
    });

    const res = await request(app.getHttpServer())
      .post(`/rooms/${roomId}/queue`)
      .set('Authorization', `Bearer ${memberToken}`)
      .send({ trackId: memberTrack.id })
      .expect(201);

    expect((res.body as QueueEntryResponseBody).trackId).toBe(memberTrack.id);
  });

  it('the host skips to the queued track', async () => {
    const res = await request(app.getHttpServer())
      .post(`/rooms/${roomId}/playback/skip`)
      .set('Authorization', `Bearer ${hostToken}`)
      .send({})
      .expect(201);

    const body = res.body as PlaybackResponseBody;
    expect(body.status).toBe('PLAYING');
    expect(body.trackId).not.toBe(trackId);
  });
});
