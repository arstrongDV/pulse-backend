import { IsUUID } from 'class-validator';

export class PauseEventDto {
  @IsUUID()
  roomId!: string;
}
