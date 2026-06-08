import { IsOptional, IsString, IsNumber } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationDto } from '../../common/dto/pagination.dto';

export class CreateInventarioDto {
  @ApiPropertyOptional()
  @IsString()
  nombre: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  tipo?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  total?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  descuento?: number;
}

export class UpdateInventarioDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  nombre?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  tipo?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  total?: number;
}

export class CreateOrderInventarioDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  IDinventario?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  categoria?: string;

  @ApiPropertyOptional()
  @IsString()
  nombreDelAlimento: string;

  @ApiPropertyOptional()
  @IsNumber()
  cantidad: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  precio?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  provedor?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  telefonoProvedor?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  direccionProvedor?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  precioActual?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  subtotal?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  precioAnterior?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  observacion?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  disponible?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  seCompro?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  nombreCategoria?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  fecha?: string;
}

export class UpdateOrderInventarioDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  cantidad?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  precio?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  precioActual?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  nombreDelAlimento?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  observacion?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  subtotal?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  precioAnterior?: number;
}

export class InventarioQueryDto extends PaginationDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  tipo?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  buscar?: string;
}

export class OrderInventarioQueryDto extends PaginationDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  buscar?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  tipo?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  provedor?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  fechaInicio?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  fechaFin?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  categoria?: string;
}
