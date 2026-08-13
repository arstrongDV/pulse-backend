import { Module } from '@nestjs/common';
import { RealtimeGateway } from './realtime.gateway';
import { AuthModule } from '../auth/auth.module';
import { RoomsModule } from '../rooms/rooms.module';
import { PlaybackModule } from '../playback/playback.module';

@Module({
  imports: [AuthModule, RoomsModule, PlaybackModule],
  providers: [RealtimeGateway],
})
export class RealtimeModule {}
