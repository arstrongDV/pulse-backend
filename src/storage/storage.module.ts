import { Module } from '@nestjs/common';
import { S3Client } from '@aws-sdk/client-s3';
import { StorageService } from './storage.service';
import { S3_CLIENT } from './storage.constants';
import { requireEnv } from '../common/config/env';

@Module({
  providers: [
    StorageService,
    {
      provide: S3_CLIENT,
      useFactory: () =>
        new S3Client({
          region: 'auto',
          endpoint: `https://${requireEnv('R2_ACCOUNT_ID')}.r2.cloudflarestorage.com`,
          credentials: {
            accessKeyId: requireEnv('R2_ACCESS_KEY_ID'),
            secretAccessKey: requireEnv('R2_SECRET_ACCESS_KEY'),
          },
        }),
    },
  ],
  exports: [StorageService],
})
export class StorageModule {}
