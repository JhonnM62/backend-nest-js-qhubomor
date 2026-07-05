import {
  IsString, IsNumber, IsOptional, IsBoolean, IsNotEmpty,
  IsDateString, IsIn, IsArray, Min, ArrayMinSize
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type, Transform } from 'class-transformer';

// ─── TURNOS ───────────────────────────────────────────────────────────────────

export class RegistrarEntradaDto {
  @ApiPropertyOptional({ description: 'Latitud GPS al hacer check-in' })
  @IsOptional()
  @IsNumber()
  latitud?: number;

  @ApiPropertyOptional({ description: 'Longitud GPS al hacer check-in' })
  @IsOptional()
  @IsNumber()
  longitud?: number;

  @ApiPropertyOptional({ description: 'Observación opcional al iniciar turno' })
  @IsOptional()
  @IsString()
  observacion?: string;
}

export class RegistrarSalidaDto {
  @ApiProperty({ description: '¿Cenó el empleado durante este turno? (OBLIGATORIO)' })
  @IsNotEmpty({ message: 'Debes indicar si el empleado cenó o no. Este campo es obligatorio.' })
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean({ message: 'El campo "ceno" debe ser true o false' })
  ceno: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  observacion?: string;

  @ApiPropertyOptional({ description: 'Latitud GPS al hacer check-out' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  latitud?: number;

  @ApiPropertyOptional({ description: 'Longitud GPS al hacer check-out' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  longitud?: number;
}

export class UpdateTurnoAdminDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  ceno?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsIn(['ACTIVO', 'COMPLETADO', 'ANULADO'])
  estado?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  observacion?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  valorTurno?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  horaSalida?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  horaEntrada?: string;
}

export class TurnosQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  usuarioId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  fechaDesde?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  fechaHasta?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsIn(['ACTIVO', 'COMPLETADO', 'ANULADO'])
  estado?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  page?: number = 1;

  @ApiPropertyOptional({ default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  limit?: number = 50;
}

// ─── DESCUENTOS ───────────────────────────────────────────────────────────────

const CONCEPTOS_VALIDOS = ['DESCUADRE_CAJA', 'CENA', 'PERDIDA', 'ROBO', 'ADELANTO', 'OTRO'];

export class CreateDescuentoDto {
  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  usuarioId: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  turnoId?: string;

  @ApiProperty({ enum: CONCEPTOS_VALIDOS })
  @IsNotEmpty()
  @IsString()
  @IsIn(CONCEPTOS_VALIDOS, { message: `Concepto debe ser uno de: ${CONCEPTOS_VALIDOS.join(', ')}` })
  concepto: string;

  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  descripcion: string;

  @ApiProperty()
  @IsNotEmpty()
  @IsNumber()
  @Min(1, { message: 'El valor debe ser mayor a 0' })
  @Type(() => Number)
  valor: number;
}

export class RepartirDescuentoDto {
  @ApiProperty({ type: [String], description: 'IDs de empleados entre quienes se reparte' })
  @IsArray()
  @ArrayMinSize(1, { message: 'Selecciona al menos 1 empleado' })
  @IsString({ each: true })
  usuarioIds: string[];

  @ApiProperty({ description: 'Monto total a repartir equitativamente' })
  @IsNotEmpty()
  @IsNumber()
  @Min(1)
  @Type(() => Number)
  montoTotal: number;

  @ApiProperty({ enum: CONCEPTOS_VALIDOS })
  @IsNotEmpty()
  @IsString()
  @IsIn(CONCEPTOS_VALIDOS)
  concepto: string;

  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  descripcion: string;

  @ApiPropertyOptional({ description: 'Turno al que se vincula (opcional)' })
  @IsOptional()
  @IsString()
  turnoId?: string;
  @ApiPropertyOptional({ description: 'Fecha en la que se generó el descuento' })
  @IsOptional()
  @IsDateString()
  fecha?: string;
}

export class UpdateDescuentoDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  descripcion?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Type(() => Number)
  valor?: number;

  @ApiPropertyOptional({ enum: ['PENDIENTE', 'VISTO', 'APROBADO'] })
  @IsOptional()
  @IsString()
  @IsIn(['PENDIENTE', 'VISTO', 'APROBADO'])
  estado?: string;

  @ApiPropertyOptional({ description: 'Fecha del descuento' })
  @IsOptional()
  @IsDateString()
  fecha?: string;
}

export class DescuentosQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  usuarioId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  estado?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  fechaDesde?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  fechaHasta?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  page?: number = 1;

  @ApiPropertyOptional({ default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  limit?: number = 50;
}

// ─── LIQUIDACIONES ────────────────────────────────────────────────────────────

export class LiquidarEmpleadoDto {
  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  usuarioId: string;

  @ApiProperty({ description: 'Fecha inicio del período (YYYY-MM-DD)' })
  @IsNotEmpty()
  @IsDateString()
  fechaInicio: string;

  @ApiProperty({ description: 'Fecha fin del período (YYYY-MM-DD)' })
  @IsNotEmpty()
  @IsDateString()
  fechaFin: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  observaciones?: string;
}
