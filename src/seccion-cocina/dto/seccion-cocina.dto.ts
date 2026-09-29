import { IsString, IsOptional, IsBoolean, IsInt, IsNotEmpty, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';

export class CreateSeccionCocinaDto {
  @ApiProperty({ description: 'Nombre de la sección (ej: Cocina, Bebidas, Parrilla)' })
  @IsString()
  @IsNotEmpty()
  nombre: string;

  @ApiPropertyOptional({ description: 'Color hexadecimal', default: '#FF6B35' })
  @IsOptional()
  @IsString()
  color?: string;

  @ApiPropertyOptional({ description: 'Nombre del icono (Ionicons)', default: 'restaurant-outline' })
  @IsOptional()
  @IsString()
  icono?: string;

  @ApiPropertyOptional({ description: 'Orden de impresión del ticket', default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  orden?: number;

  @ApiPropertyOptional({ description: 'Si la sección está activa', default: true })
  @IsOptional()
  @IsBoolean()
  activa?: boolean;
}

export class UpdateSeccionCocinaDto extends PartialType(CreateSeccionCocinaDto) {}
