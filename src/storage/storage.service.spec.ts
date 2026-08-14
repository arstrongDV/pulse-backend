import { Test, TestingModule } from '@nestjs/testing';
import {
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { StorageService } from './storage.service';
import { S3_CLIENT } from './storage.constants';

jest.mock('@aws-sdk/s3-request-presigner');

describe('StorageService', () => {
  let service: StorageService;
  const s3ClientMock = { send: jest.fn() };
  const getSignedUrlMock = getSignedUrl as jest.Mock;

  beforeAll(() => {
    process.env.R2_BUCKET_NAME = 'test-bucket';
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StorageService,
        { provide: S3_CLIENT, useValue: s3ClientMock },
      ],
    }).compile();

    service = module.get<StorageService>(StorageService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createUploadUrl', () => {
    it('requests a presigned PUT url for the given key and content type', async () => {
      getSignedUrlMock.mockResolvedValue('https://signed-put-url');

      const url = await service.createUploadUrl(
        'tracks/user-1/track.mp3',
        'audio/mpeg',
      );

      expect(url).toBe('https://signed-put-url');
      expect(getSignedUrlMock).toHaveBeenCalledWith(
        s3ClientMock,
        expect.any(PutObjectCommand),
        { expiresIn: 300 },
      );

      const call = getSignedUrlMock.mock.calls[0] as unknown[];
      const command = call[1] as PutObjectCommand;
      expect(command.input).toEqual({
        Bucket: 'test-bucket',
        Key: 'tracks/user-1/track.mp3',
        ContentType: 'audio/mpeg',
      });
    });
  });

  describe('createDownloadUrl', () => {
    it('requests a presigned GET url for the given key', async () => {
      getSignedUrlMock.mockResolvedValue('https://signed-get-url');

      const url = await service.createDownloadUrl('tracks/user-1/track.mp3');

      expect(url).toBe('https://signed-get-url');
      expect(getSignedUrlMock).toHaveBeenCalledWith(
        s3ClientMock,
        expect.any(GetObjectCommand),
        { expiresIn: 3600 },
      );

      const call = getSignedUrlMock.mock.calls[0] as unknown[];
      const command = call[1] as GetObjectCommand;
      expect(command.input).toEqual({
        Bucket: 'test-bucket',
        Key: 'tracks/user-1/track.mp3',
      });
    });
  });

  describe('headObject', () => {
    it('returns contentType/size when the object exists', async () => {
      s3ClientMock.send.mockResolvedValue({
        ContentType: 'audio/mpeg',
        ContentLength: 12345,
      });

      const result = await service.headObject('tracks/user-1/track.mp3');

      expect(result).toEqual({ contentType: 'audio/mpeg', size: 12345 });
      expect(s3ClientMock.send).toHaveBeenCalledWith(
        expect.any(HeadObjectCommand),
      );

      const call = s3ClientMock.send.mock.calls[0] as unknown[];
      const command = call[0] as HeadObjectCommand;
      expect(command.input).toEqual({
        Bucket: 'test-bucket',
        Key: 'tracks/user-1/track.mp3',
      });
    });

    it('returns null when the object does not exist', async () => {
      const notFound = new Error('not found');
      notFound.name = 'NotFound';
      s3ClientMock.send.mockRejectedValue(notFound);

      const result = await service.headObject('tracks/user-1/missing.mp3');

      expect(result).toBeNull();
    });

    it('rethrows unexpected errors', async () => {
      s3ClientMock.send.mockRejectedValue(new Error('network down'));

      await expect(
        service.headObject('tracks/user-1/track.mp3'),
      ).rejects.toThrow('network down');
    });
  });

  describe('deleteObject', () => {
    it('sends a DeleteObjectCommand for the given key', async () => {
      s3ClientMock.send.mockResolvedValue({});

      await service.deleteObject('tracks/user-1/track.mp3');

      expect(s3ClientMock.send).toHaveBeenCalledWith(
        expect.any(DeleteObjectCommand),
      );

      const call = s3ClientMock.send.mock.calls[0] as unknown[];
      const command = call[0] as DeleteObjectCommand;
      expect(command.input).toEqual({
        Bucket: 'test-bucket',
        Key: 'tracks/user-1/track.mp3',
      });
    });
  });
});
