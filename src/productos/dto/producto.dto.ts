import { IsOptional, IsString, IsNumber, IsBoolean, Min, IsArray, ValidateNested } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { PaginationDto } from '../../common/dto/pagination.dto';

export class RecetaInsumoDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  idinsumos?: string;

  @IsString()
  insumo: string; // ID del insumo

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  tipoDeMedida?: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  cantidad: number;
}

export class CreateProductoDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  categoria?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  categoriaNombre?: string;

  @ApiPropertyOptional()
  @IsString()
  nombre: string;

  @ApiPropertyOptional({ default: 'si' })
  @IsOptional()
  @IsString()
  mostrar?: string;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  cantidad?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  precioUnitario?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  image?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  imagenUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  precioDeCompra?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  unidades?: string;

  @ApiPropertyOptional({ default: 'no' })
  @IsOptional()
  @IsString()
  descontar?: string;

  @ApiPropertyOptional({ default: 'no' })
  @IsOptional()
  @IsString()
  llevarControlEnCaja?: string;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  orden?: number;

  @ApiPropertyOptional({ type: [RecetaInsumoDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RecetaInsumoDto)
  recetaInsumos?: RecetaInsumoDto[];
}

export class UpdateProductoDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  categoria?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  categoriaNombre?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  nombre?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  mostrar?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  cantidad?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  precioUnitario?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  image?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  imagenUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  precioDeCompra?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  unidades?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  descontar?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  llevarControlEnCaja?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  orden?: number;

  @ApiPropertyOptional({ type: [RecetaInsumoDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RecetaInsumoDto)
  recetaInsumos?: RecetaInsumoDto[];
}

export class ProductoQueryDto extends PaginationDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  categoria?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  buscar?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  soloMostrar?: boolean;
}
