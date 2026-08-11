import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';
import { trimAndLowercase } from '../../common/transformers/normalize.transformer';

export class AuthPayloadDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(3)
  @MaxLength(255)
  @Transform(({ value }) => trimAndLowercase(value))
  identifier!: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(8)
  @MaxLength(72) // Prevents DoS attacks on password hashing
  password!: string;
}
