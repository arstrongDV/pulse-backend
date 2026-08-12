import { IsUUID } from 'class-validator';
import { CreateMessagePayloadDto } from '../../rooms/dto/create-message.dto';

export class SendMessageEventDto extends CreateMessagePayloadDto {
  @IsUUID()
  roomId!: string;
}
