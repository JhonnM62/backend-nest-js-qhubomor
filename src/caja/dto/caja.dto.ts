import { IsOptional, IsString, IsNumber, IsArray, ValidateNested, IsDateString, IsBoolean } from 'class-validator';
import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class InsumoAperturaDto {
  @ApiProperty()
  @IsString()
  nombreInsumo: string;

  @ApiProperty()
  @IsNumber()
  cantApertura: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  unidadDeMedida?: string;
  
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  categoria?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  paraQueProducto?: string;

  @ApiPropertyOptional()
  @IsOptional()
  nombreInsumoReal?: string;

  @ApiPropertyOptional()
  @IsOptional()
  nombreProductoReal?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  cantDeCierre?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  observacion?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  imageUrl?: string;
}

export class CreateAperturaCierreCajaDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  nombre?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  apertura?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  fechaDeApertura?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  usuario?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  observaciones?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  efectivoDeApertura?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  efectivoDeCierre?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  horaDeApertura?: string;

  @ApiPropertyOptional({ type: [InsumoAperturaDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => InsumoAperturaDto)
  insumos?: InsumoAperturaDto[];
}

export class InsumoCierreDto {
  @ApiProperty()
  @IsString()
  nombreInsumo: string;

  @ApiProperty()
  @IsNumber()
  cantDeCierre: number;
}

export class UpdateCierreCajaDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  efectivoDeCierre?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  horaDeCierre?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  resumen?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  plataGuardada?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  valorFaltante?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  valorExcedente?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  observaciones?: string;

  @ApiPropertyOptional({ type: [InsumoCierreDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => InsumoCierreDto)
  insumos?: InsumoCierreDto[];
}

export class CajaQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  nombre?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  fechaDesde?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  fechaHasta?: string;
}
