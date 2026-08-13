import { IsBoolean, IsUUID } from 'class-validator';

export class MemberStatusEventDto {
  @IsUUID()
  roomId!: string;

  @IsBoolean()
  lagging!: boolean;
}
