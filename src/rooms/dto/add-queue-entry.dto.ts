import { IsUUID } from 'class-validator';

export class AddQueueEntryDto {
  @IsUUID()
  trackId!: string;
}
