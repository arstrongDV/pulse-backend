import { IsInt, IsOptional, IsString, Min } from 'class-validator';

export class PlayPayloadDto {
  @IsOptional()
  @IsString()
  trackId?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  positionMs?: number;
}
