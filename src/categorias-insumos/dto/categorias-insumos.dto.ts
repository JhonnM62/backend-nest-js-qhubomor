import { IsString, IsOptional, IsNotEmpty } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateCategoriaInsumoDto {
  @ApiProperty({ description: 'El nombre de la categoría de insumo' })
  @IsString()
  @IsNotEmpty()
  nombre: string;

  @ApiPropertyOptional({ description: 'URL de la imagen de la categoría' })
  @IsString()
  @IsOptional()
  imagen?: string;
}

export class UpdateCategoriaInsumoDto {
  @ApiPropertyOptional({ description: 'El nombre de la categoría de insumo' })
  @IsString()
  @IsOptional()
  nombre?: string;

  @ApiPropertyOptional({ description: 'URL de la imagen de la categoría' })
  @IsString()
  @IsOptional()
  imagen?: string;
}
