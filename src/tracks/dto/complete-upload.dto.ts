import { Transform } from 'class-transformer';
import { IsInt, IsNotEmpty, IsString, Min, MaxLength } from 'class-validator';
import { trimString } from '../../common/transformers/normalize.transformer';

export class CompleteUploadPayloadDto {
  @IsString()
  @IsNotEmpty()
  key!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  @Transform(({ value }) => trimString(value))
  title!: string;

  @IsInt()
  @Min(1)
  durationMs!: number;
}
