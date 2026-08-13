import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthenticatedRequest } from '../user/user.controller';
import { PlaybackService } from './playback.service';
import { PlayPayloadDto } from './dto/play-payload.dto';
import { SeekPayloadDto } from './dto/seek-payload.dto';
import { SkipPayloadDto } from './dto/skip-payload.dto';

@ApiTags('playback')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('rooms/:id/playback')
export class PlaybackController {
  constructor(private readonly playbackService: PlaybackService) {}

  @Get()
  getState(@Param('id', ParseUUIDPipe) roomId: string) {
    return this.playbackService.getState(roomId);
  }

  @Post('play')
  play(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) roomId: string,
    @Body() payload: PlayPayloadDto,
  ) {
    return this.playbackService.play(
      req.user.id,
      roomId,
      payload.trackId,
      payload.positionMs,
    );
  }

  @Post('pause')
  pause(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) roomId: string,
  ) {
    return this.playbackService.pause(req.user.id, roomId);
  }

  @Post('seek')
  seek(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) roomId: string,
    @Body() payload: SeekPayloadDto,
  ) {
    return this.playbackService.seek(req.user.id, roomId, payload.positionMs);
  }

  @Post('skip')
  skip(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) roomId: string,
    @Body() payload: SkipPayloadDto,
  ) {
    return this.playbackService.skip(req.user.id, roomId, payload.trackId);
  }
}
