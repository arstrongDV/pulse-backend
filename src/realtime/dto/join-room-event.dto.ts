import { IsUUID } from 'class-validator';

export class JoinRoomEventDto {
  @IsUUID()
  roomId!: string;
}
