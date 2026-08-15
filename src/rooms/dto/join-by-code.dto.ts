import { Transform } from 'class-transformer';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { trimAndUppercase } from '../../common/transformers/normalize.transformer';

export class JoinByCodePayloadDto {
  @IsString()
  @IsNotEmpty()
  @Transform(({ value }) => trimAndUppercase(value))
  code!: string;

  @IsOptional()
  @IsString()
  password?: string;
}
