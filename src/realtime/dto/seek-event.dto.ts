import { IsUUID } from 'class-validator';
import { SeekPayloadDto } from '../../playback/dto/seek-payload.dto';

export class SeekEventDto extends SeekPayloadDto {
  @IsUUID()
  roomId!: string;
}
