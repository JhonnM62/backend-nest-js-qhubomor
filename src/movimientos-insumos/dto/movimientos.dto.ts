import { IsString, IsNumber, IsOptional, IsNotEmpty, Min, IsBoolean } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AbrirPaqueteDto {
  @ApiProperty({ description: 'ID del insumo (ej. Tocineta)' })
  @IsNotEmpty()
  @IsString()
  insumoId: string;

  @ApiPropertyOptional({ description: 'ID de la caja activa desde la que se abre' })
  @IsOptional()
  @IsString()
  cajaId?: string;

  @ApiProperty({ description: 'Cantidad real reportada por el empleado' })
  @IsNotEmpty()
  @IsNumber()
  @Min(0)
  cantidadReal: number;

  @ApiPropertyOptional({ description: 'Indica si se debe sincronizar la diferencia con el stock global' })
  @IsOptional()
  @IsBoolean()
  syncGlobalStock?: boolean;
  @ApiPropertyOptional({ description: 'Cantidad de paquetes a abrir simultáneamente (por defecto 1)' })
  @IsOptional()
  @IsNumber()
  @Min(1)
  cantidadDePaquetes?: number;
}

export class DescuentoProduccionDto {
  @ApiProperty({ description: 'ID del insumo (ej. Pollo)' })
  @IsNotEmpty()
  @IsString()
  insumoId: string;

  @ApiPropertyOptional({ description: 'ID de la caja activa desde la que se descuenta' })
  @IsOptional()
  @IsString()
  cajaId?: string;

  @ApiProperty({ description: 'Cantidad a descontar (ej. para la cena)' })
  @IsNotEmpty()
  @IsNumber()
  @Min(1)
  cantidadDescontada: number;

  @ApiPropertyOptional({ description: 'Observación opcional del descuento' })
  @IsOptional()
  @IsString()
  observacion?: string;
}

export class EntradaLibreDto {
  @ApiProperty({ description: 'ID del insumo' })
  @IsNotEmpty()
  @IsString()
  insumoId: string;

  @ApiPropertyOptional({ description: 'ID de la caja activa' })
  @IsOptional()
  @IsString()
  cajaId?: string;

  @ApiProperty({ description: 'Cantidad a ingresar (Real)' })
  @IsNotEmpty()
  @IsNumber()
  @Min(1)
  cantidadAgregada: number;

  @ApiPropertyOptional({ description: 'Cantidad teórica esperada (para calcular mermas/ajustes)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  cantidadTeorica?: number;

  @ApiPropertyOptional({ description: 'Indica si se debe sincronizar la entrada con el stock global' })
  @IsOptional()
  @IsBoolean()
  syncGlobalStock?: boolean;

  @ApiPropertyOptional({ description: 'Observación opcional' })
  @IsOptional()
  @IsString()
  observacion?: string;
}
