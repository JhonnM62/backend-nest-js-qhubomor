import { IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RefreshTokenDto {
  @ApiProperty({ description: 'The (possibly expired) JWT access token' })
  @IsString()
  @IsNotEmpty()
  token: string;
}

export class RefreshTokenResponseDto {
  @ApiProperty()
  accessToken: string;
}
