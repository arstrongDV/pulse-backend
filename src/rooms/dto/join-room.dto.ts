import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class JoinRoomPayloadDto {
  @IsOptional()
  @IsString()
  @MinLength(4)
  @MaxLength(72)
  password?: string;
}
