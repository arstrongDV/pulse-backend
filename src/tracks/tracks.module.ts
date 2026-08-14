import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module';
import { TracksService } from './tracks.service';
import { TracksController } from './tracks.controller';

@Module({
  imports: [StorageModule],
  providers: [TracksService],
  controllers: [TracksController],
})
export class TracksModule {}
