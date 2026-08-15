import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { RoomsService } from './rooms.service';
import { CreateRoomPayloadDto } from './dto/create-room.dto';
import { JoinRoomPayloadDto } from './dto/join-room.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthenticatedRequest } from '../user/user.controller';
import { CreateMessagePayloadDto } from './dto/create-message.dto';
import { GetMessagesQueryDto } from './dto/get-messages-query.dto';
import { AddQueueEntryDto } from './dto/add-queue-entry.dto';

@ApiTags('rooms')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('rooms')
export class RoomsController {
  constructor(private readonly roomsService: RoomsService) {}

  @Post()
  createRoom(
    @Req() req: AuthenticatedRequest,
    @Body() createRoomPayload: CreateRoomPayloadDto,
  ) {
    return this.roomsService.createRoom(req.user.id, createRoomPayload);
  }

  @Get(':id')
  getRoomById(@Param('id', ParseUUIDPipe) id: string) {
    return this.roomsService.getRoomById(id);
  }

  @Post(':id/join')
  joinRoom(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() joinRoomPayload: JoinRoomPayloadDto,
  ) {
    return this.roomsService.joinRoom(
      req.user.id,
      id,
      joinRoomPayload.password,
    );
  }

  @Post(':id/leave')
  leaveRoom(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.roomsService.leaveRoom(req.user.id, id);
  }

  @Delete(':id')
  deleteRoom(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.roomsService.deleteRoom(req.user.id, id);
  }

  @Throttle({ default: { limit: 20, ttl: 10_000 } })
  @Post(':id/messages')
  createMessage(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() createMessagePayload: CreateMessagePayloadDto,
  ) {
    return this.roomsService.createMessage(
      req.user.id,
      id,
      createMessagePayload,
    );
  }

  @Get(':id/messages')
  getMessages(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: GetMessagesQueryDto,
  ) {
    return this.roomsService.getRoomMessages(
      req.user.id,
      id,
      query.page,
      query.limit,
    );
  }

  @Post('/:id/queue')
  putInQueue(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() payload: AddQueueEntryDto,
  ) {
    return this.roomsService.addToQueue(req.user.id, id, payload.trackId);
  }

  @Get('/:id/queue')
  getFromQueue(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.roomsService.getRoomQueue(req.user.id, id);
  }

  @Delete('/:id/queue/:entryId')
  deleteEntry(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) roomId: string,
    @Param('entryId', ParseUUIDPipe) entryId: string,
  ) {
    return this.roomsService.deleteEntry(req.user.id, roomId, entryId);
  }
}
