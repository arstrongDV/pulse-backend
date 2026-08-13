import { IsNotEmpty, IsString } from 'class-validator';

export class SkipPayloadDto {
  @IsString()
  @IsNotEmpty()
  trackId!: string;
}
