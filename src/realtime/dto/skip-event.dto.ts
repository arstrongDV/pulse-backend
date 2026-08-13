import { IsUUID } from 'class-validator';
import { SkipPayloadDto } from '../../playback/dto/skip-payload.dto';

export class SkipEventDto extends SkipPayloadDto {
  @IsUUID()
  roomId!: string;
}
