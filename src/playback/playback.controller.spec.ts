import { Test, TestingModule } from '@nestjs/testing';
import { PlaybackController } from './playback.controller';
import { PlaybackService } from './playback.service';

describe('PlaybackController', () => {
  let controller: PlaybackController;
  const playbackServiceMock = {
    play: jest.fn(),
    getState: jest.fn(),
    pause: jest.fn(),
    seek: jest.fn(),
    skip: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PlaybackController],
      providers: [{ provide: PlaybackService, useValue: playbackServiceMock }],
    }).compile();

    controller = module.get<PlaybackController>(PlaybackController);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('getState delegates to PlaybackService', async () => {
    const state = { status: 'STOPPED' };
    playbackServiceMock.getState.mockResolvedValue(state);

    await expect(controller.getState('room-1')).resolves.toEqual(state);
    expect(playbackServiceMock.getState).toHaveBeenCalledWith('room-1');
  });

  it('play delegates to PlaybackService with the authenticated user id', async () => {
    const state = { status: 'PLAYING' };
    playbackServiceMock.play.mockResolvedValue(state);

    const req = { user: { id: 'user-1' } } as never;
    const result = await controller.play(req, 'room-1', {
      trackId: 'track-1',
      positionMs: 0,
    });

    expect(result).toEqual(state);
    expect(playbackServiceMock.play).toHaveBeenCalledWith(
      'user-1',
      'room-1',
      'track-1',
      0,
    );
  });

  it('pause delegates to PlaybackService with the authenticated user id', async () => {
    const state = { status: 'PAUSED' };
    playbackServiceMock.pause.mockResolvedValue(state);

    const req = { user: { id: 'user-1' } } as never;
    const result = await controller.pause(req, 'room-1');

    expect(result).toEqual(state);
    expect(playbackServiceMock.pause).toHaveBeenCalledWith('user-1', 'room-1');
  });

  it('seek delegates to PlaybackService with the authenticated user id', async () => {
    const state = { status: 'PLAYING', positionMs: 90_000 };
    playbackServiceMock.seek.mockResolvedValue(state);

    const req = { user: { id: 'user-1' } } as never;
    const result = await controller.seek(req, 'room-1', { positionMs: 90_000 });

    expect(result).toEqual(state);
    expect(playbackServiceMock.seek).toHaveBeenCalledWith(
      'user-1',
      'room-1',
      90_000,
    );
  });

  it('skip delegates to PlaybackService with the authenticated user id', async () => {
    const state = { status: 'PLAYING', trackId: 'track-2' };
    playbackServiceMock.skip.mockResolvedValue(state);

    const req = { user: { id: 'user-1' } } as never;
    const result = await controller.skip(req, 'room-1', { trackId: 'track-2' });

    expect(result).toEqual(state);
    expect(playbackServiceMock.skip).toHaveBeenCalledWith(
      'user-1',
      'room-1',
      'track-2',
    );
  });
});
