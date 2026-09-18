import { IsString, IsNotEmpty, MaxLength, IsOptional, IsNumber } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateMesaDto {
  @ApiProperty({ description: 'Nombre de la mesa', example: 'Mesa 1' })
  @IsString()
  @IsNotEmpty({ message: 'El nombre de la mesa no puede estar vacío' })
  @MaxLength(50, { message: 'El nombre de la mesa no puede exceder los 50 caracteres' })
  nombre: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumber()
  posX?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumber()
  posY?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumber()
  width?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumber()
  height?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  tipo?: string;
}
