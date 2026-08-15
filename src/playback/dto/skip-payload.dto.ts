import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class SkipPayloadDto {
  @IsString()
  @IsNotEmpty()
  @IsOptional()
  trackId?: string;
}
