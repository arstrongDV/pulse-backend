import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { RoomVisibility } from '@prisma/client';
import { trimString } from '../../common/transformers/normalize.transformer';

export class CreateRoomPayloadDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  @Transform(({ value }) => trimString(value))
  name?: string;

  @IsEnum(RoomVisibility)
  visibility!: RoomVisibility;

  @IsInt()
  @Min(2)
  @Max(50)
  maxParticipants!: number;

  @IsOptional()
  @IsString()
  @MinLength(4)
  @MaxLength(72)
  password?: string;
}
