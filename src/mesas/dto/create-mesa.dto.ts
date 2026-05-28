import { IsString, IsNotEmpty, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateMesaDto {
  @ApiProperty({ description: 'Nombre de la mesa', example: 'Mesa 1' })
  @IsString()
  @IsNotEmpty({ message: 'El nombre de la mesa no puede estar vacío' })
  @MaxLength(50, { message: 'El nombre de la mesa no puede exceder los 50 caracteres' })
  nombre: string;
}
