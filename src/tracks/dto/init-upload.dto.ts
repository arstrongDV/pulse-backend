import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  ALLOWED_AUDIO_MIME_TYPES,
  MAX_TRACK_SIZE_BYTES,
} from '../tracks.constants';

export class InitUploadPayloadDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  filename!: string;

  @IsIn(ALLOWED_AUDIO_MIME_TYPES)
  contentType!: string;

  @IsInt()
  @Min(1)
  @Max(MAX_TRACK_SIZE_BYTES)
  size!: number;
}
