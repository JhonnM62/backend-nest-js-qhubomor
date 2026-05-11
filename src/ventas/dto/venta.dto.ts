import { IsOptional, IsString, IsNumber, IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationDto } from '../../common/dto/pagination.dto';

export class CreateVentaDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  mesa?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  estado?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  medioDePago?: string;

  @ApiPropertyOptional()
  @IsOptional()
  banco?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  efectivoRecibido?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  devueltas?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  descuento?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  porcentajeDeDescuento?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  costoDelDomicilio?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  direccion?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  cliente?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  numeroTelefono?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  mensaje?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  totalInput?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  pedido?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  cartStartTime?: string | null;
}

export class CreateOrderVentaDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  IDventas?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  categoria?: string;

  @ApiPropertyOptional()
  @IsString()
  nombre: string;

  @ApiPropertyOptional()
  @IsNumber()
  cantidad: number;

  @ApiPropertyOptional()
  @IsNumber()
  precio: number;

  @ApiPropertyOptional()
  @IsNumber()
  precioTotal: number;

  @ApiPropertyOptional({ default: 'pendiente' })
  @IsOptional()
  @IsString()
  estado?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  comentarios?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  productoId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  usuarioId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  salsa?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  helado?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  topings?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  nombreProducto?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  categoriaProducto?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  imagenUrl?: string;
}

export class CreateVentaCompletaDto {
  @ValidateNested()
  @Type(() => CreateVentaDto)
  venta: CreateVentaDto;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateOrderVentaDto)
  productos: CreateOrderVentaDto[];
}

export class UpdateVentaDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  mesa?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  estado?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  medioDePago?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  efectivoRecibido?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  devueltas?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  totalInput?: number;
}

export class AddProductosDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateOrderVentaDto)
  productos: CreateOrderVentaDto[];
}

export class VentaQueryDto extends PaginationDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  estado?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  usuario?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  mesa?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  fechaDesde?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  fechaHasta?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  medioDePago?: string;

  @ApiPropertyOptional()
  @IsOptional()
  includeDeleted?: boolean | string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  search?: string;

  // Nuevos filtros avanzados
  @ApiPropertyOptional()
  @IsOptional()
  totalMin?: string | number;

  @ApiPropertyOptional()
  @IsOptional()
  totalMax?: string | number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  productoId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  categoriaProducto?: string;
}
