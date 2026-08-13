import { IsUUID } from 'class-validator';
import { PlayPayloadDto } from '../../playback/dto/play-payload.dto';

export class PlayEventDto extends PlayPayloadDto {
  @IsUUID()
  roomId!: string;
}
