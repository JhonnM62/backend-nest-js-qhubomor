import { IsOptional, IsString, IsNumber, IsBoolean, IsDateString, Min, IsNotEmpty } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class CreateInsumoDto {
  @ApiPropertyOptional()
  @IsNotEmpty({ message: 'El nombre es obligatorio' })
  @IsString()
  nombre: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  categoria?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  nombreCategoria?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  unidades?: string;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0, { message: 'La cantidad no puede ser negativa' })
  cantidad?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  imagen?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  imageUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  fecha_de_vencimiento?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0, { message: 'El precio no puede ser negativo' })
  precio?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0, { message: 'El total no puede ser negativo' })
  total?: number;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  agregar_cantidad?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  descontar_cant_de_ventas?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notificar_a_whatsapp?: string;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  apartir_de_cantidad?: number;

  @ApiPropertyOptional({ default: 'Si' })
  @IsOptional()
  @IsString()
  enviar_si_o_no?: string;

  @ApiPropertyOptional({ default: 'Si' })
  @IsOptional()
  @IsString()
  disponible?: string;

  @IsOptional()
  @IsString()
  estado?: string;

  @IsOptional()
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  llevar_control_en_caja?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  contador?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  contador2?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  imagencard?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  fecha?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  stockMinimo?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  stockMaximo?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  puntoReorden?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  unidadMedida?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  proveedorId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  proveedorNombre?: string;
}

export class UpdateInsumoDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  nombre?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  categoria?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  nombreCategoria?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  unidades?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  cantidad?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  imagen?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  imageUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  fecha_de_vencimiento?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  precio?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  total?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  agregar_cantidad?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  descontar_cant_de_ventas?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notificar_a_whatsapp?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  apartir_de_cantidad?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  enviar_si_o_no?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  disponible?: string;

  @IsOptional()
  @IsString()
  estado?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  llevar_control_en_caja?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  contador?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  contador2?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  imagencard?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  fecha?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  stockMinimo?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  stockMaximo?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  puntoReorden?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  unidadMedida?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  proveedorId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  proveedorNombre?: string;
}

export class InsumoQueryDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @IsNumber()
  page?: number = 1;

  @ApiPropertyOptional({ default: 50 })
  @IsOptional()
  @IsNumber()
  limit?: number = 50;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  buscar?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  categoria?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  disponible?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  estadoStock?: 'critico' | 'normal' | 'sobrante';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  ordenarPor?: string;

  @ApiPropertyOptional({ default: 'asc' })
  @IsOptional()
  @IsString()
  orden?: 'asc' | 'desc';
}

export class MovimientoInsumoDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  tipo?: 'entrada' | 'salida' | 'ajuste';

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  cantidad?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  motivo?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  observaciones?: string;
}

export class BulkInsumoDto {
  @ApiPropertyOptional({ type: [CreateInsumoDto] })
  insumos: CreateInsumoDto[];
}

export const ESTADO_STOCK = {
  CRITICO: 'critico',
  NORMAL: 'normal',
  SOBRANTE: 'sobrante',
} as const;

export type EstadoStock = typeof ESTADO_STOCK[keyof typeof ESTADO_STOCK];