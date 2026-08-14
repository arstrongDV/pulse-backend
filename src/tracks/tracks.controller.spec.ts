import { Test, TestingModule } from '@nestjs/testing';
import { TracksController } from './tracks.controller';
import { TracksService } from './tracks.service';

describe('TracksController', () => {
  let controller: TracksController;
  const tracksServiceMock = {
    initUpload: jest.fn(),
    completeUpload: jest.fn(),
    getDownloadUrl: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [TracksController],
      providers: [{ provide: TracksService, useValue: tracksServiceMock }],
    }).compile();

    controller = module.get<TracksController>(TracksController);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('initUpload delegates to TracksService with the authenticated user id', async () => {
    const response = { uploadUrl: 'https://signed-put-url', key: 'k' };
    tracksServiceMock.initUpload.mockResolvedValue(response);

    const req = { user: { id: 'user-1' } } as never;
    const payload = {
      filename: 'track.mp3',
      contentType: 'audio/mpeg',
      size: 1000,
    };
    const result = await controller.initUpload(req, payload);

    expect(result).toEqual(response);
    expect(tracksServiceMock.initUpload).toHaveBeenCalledWith(
      'user-1',
      payload,
    );
  });

  it('completeUpload delegates to TracksService with the authenticated user id', async () => {
    const track = { id: 'track-1' };
    tracksServiceMock.completeUpload.mockResolvedValue(track);

    const req = { user: { id: 'user-1' } } as never;
    const payload = { key: 'k', title: 'My track', durationMs: 1000 };
    const result = await controller.completeUpload(req, payload);

    expect(result).toEqual(track);
    expect(tracksServiceMock.completeUpload).toHaveBeenCalledWith(
      'user-1',
      payload,
    );
  });

  it('getDownloadUrl delegates to TracksService with the authenticated user id', async () => {
    const response = { id: 'track-1', url: 'https://signed-get-url' };
    tracksServiceMock.getDownloadUrl.mockResolvedValue(response);

    const req = { user: { id: 'user-1' } } as never;
    const result = await controller.getDownloadUrl(req, 'track-1');

    expect(result).toEqual(response);
    expect(tracksServiceMock.getDownloadUrl).toHaveBeenCalledWith(
      'user-1',
      'track-1',
    );
  });
});
