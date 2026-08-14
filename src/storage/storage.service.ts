import { Inject, Injectable } from '@nestjs/common';
import {
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { requireEnv } from '../common/config/env';
import { S3_CLIENT } from './storage.constants';

@Injectable()
export class StorageService {
  private readonly bucket: string;

  constructor(@Inject(S3_CLIENT) private readonly client: S3Client) {
    this.bucket = requireEnv('R2_BUCKET_NAME');
  }

  async createUploadUrl(key: string, contentType: string): Promise<string> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: contentType,
    });

    return getSignedUrl(this.client, command, {
      expiresIn: 300,
    });
  }

  async createDownloadUrl(key: string): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });

    return getSignedUrl(this.client, command, {
      expiresIn: 3600,
    });
  }

  async headObject(
    key: string,
  ): Promise<{ contentType?: string; size: number } | null> {
    try {
      const result = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return {
        contentType: result.ContentType,
        size: result.ContentLength ?? 0,
      };
    } catch (error) {
      if (error instanceof Error && error.name === 'NotFound') {
        return null;
      }
      throw error;
    }
  }

  async deleteObject(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: key,
      }),
    );
  }
}
