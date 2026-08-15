import { Test, TestingModule } from '@nestjs/testing';
import { RoomsController } from './rooms.controller';
import { RoomsService } from './rooms.service';

describe('RoomsController', () => {
  let controller: RoomsController;
  const roomsServiceMock = {
    createRoom: jest.fn(),
    addToQueue: jest.fn(),
    getRoomQueue: jest.fn(),
    deleteEntry: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [RoomsController],
      providers: [{ provide: RoomsService, useValue: roomsServiceMock }],
    }).compile();

    controller = module.get<RoomsController>(RoomsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('putInQueue delegates to RoomsService.addToQueue with the authenticated user id', async () => {
    const entry = { id: 'entry-1' };
    roomsServiceMock.addToQueue.mockResolvedValue(entry);

    const req = { user: { id: 'user-1' } } as never;
    const result = await controller.putInQueue(req, 'room-1', {
      trackId: 'track-1',
    });

    expect(result).toEqual(entry);
    expect(roomsServiceMock.addToQueue).toHaveBeenCalledWith(
      'user-1',
      'room-1',
      'track-1',
    );
  });

  it('getFromQueue delegates to RoomsService.getRoomQueue with the authenticated user id', async () => {
    const queue = [{ id: 'entry-1' }];
    roomsServiceMock.getRoomQueue.mockResolvedValue(queue);

    const req = { user: { id: 'user-1' } } as never;
    const result = await controller.getFromQueue(req, 'room-1');

    expect(result).toEqual(queue);
    expect(roomsServiceMock.getRoomQueue).toHaveBeenCalledWith(
      'user-1',
      'room-1',
    );
  });

  it('deleteEntry delegates to RoomsService.deleteEntry with the authenticated user id', async () => {
    const entry = { id: 'entry-1' };
    roomsServiceMock.deleteEntry.mockResolvedValue(entry);

    const req = { user: { id: 'user-1' } } as never;
    const result = await controller.deleteEntry(req, 'room-1', 'entry-1');

    expect(result).toEqual(entry);
    expect(roomsServiceMock.deleteEntry).toHaveBeenCalledWith(
      'user-1',
      'room-1',
      'entry-1',
    );
  });
});
