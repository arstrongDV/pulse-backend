import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RoomsService } from './rooms.service';
import { CreateRoomPayloadDto } from './dto/create-room.dto';
import { JoinRoomPayloadDto } from './dto/join-room.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthenticatedRequest } from '../user/user.controller';

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
  getRoomById(@Param('id') id: string) {
    return this.roomsService.getRoomById(id);
  }

  @Post(':id/join')
  joinRoom(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() joinRoomPayload: JoinRoomPayloadDto,
  ) {
    return this.roomsService.joinRoom(
      req.user.id,
      id,
      joinRoomPayload.password,
    );
  }

  @Post(':id/leave')
  leaveRoom(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.roomsService.leaveRoom(req.user.id, id);
  }

  @Delete(':id')
  deleteRoom(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.roomsService.deleteRoom(req.user.id, id);
  }
}
