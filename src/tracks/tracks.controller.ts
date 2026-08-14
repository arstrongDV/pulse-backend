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
import { TracksService } from './tracks.service';
import { InitUploadPayloadDto } from './dto/init-upload.dto';
import { CompleteUploadPayloadDto } from './dto/complete-upload.dto';

@ApiTags('tracks')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('tracks')
export class TracksController {
  constructor(private readonly tracksService: TracksService) {}

  @Post('upload/init')
  initUpload(
    @Req() req: AuthenticatedRequest,
    @Body() payload: InitUploadPayloadDto,
  ) {
    return this.tracksService.initUpload(req.user.id, payload);
  }

  @Post('upload/complete')
  completeUpload(
    @Req() req: AuthenticatedRequest,
    @Body() payload: CompleteUploadPayloadDto,
  ) {
    return this.tracksService.completeUpload(req.user.id, payload);
  }

  @Get(':id')
  getDownloadUrl(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.tracksService.getDownloadUrl(req.user.id, id);
  }
}
