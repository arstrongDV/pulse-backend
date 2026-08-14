import { Test, TestingModule } from '@nestjs/testing';
import { StorageController } from './storage.controller';
import { StorageService } from './storage.service';

describe('StorageController', () => {
  let controller: StorageController;
  const storageServiceMock = { createUploadUrl: jest.fn() };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [StorageController],
      providers: [{ provide: StorageService, useValue: storageServiceMock }],
    }).compile();

    controller = module.get<StorageController>(StorageController);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('testStorage delegates to StorageService.createUploadUrl', async () => {
    storageServiceMock.createUploadUrl.mockResolvedValue('https://signed-url');

    const result = await controller.testStorage();

    expect(result).toEqual({ url: 'https://signed-url' });
    expect(storageServiceMock.createUploadUrl).toHaveBeenCalledWith(
      'test/test.txt',
      'text/plain',
    );
  });
});
