import { IsString, IsNumber, IsOptional, Min, IsNotEmpty } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class CreateCargoDto {
  @ApiProperty({ example: 'Cocina' })
  @IsNotEmpty({ message: 'El nombre del cargo es obligatorio' })
  @IsString()
  nombre: string;

  @ApiPropertyOptional({ example: 54300 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  tarifaLunes?: number;

  @ApiPropertyOptional({ example: '08:00' })
  @IsOptional()
  @IsString()
  horaEntradaLunes?: string;

  @ApiPropertyOptional({ example: '14:00' })
  @IsOptional()
  @IsString()
  horaSalidaLunes?: string;

  @ApiPropertyOptional({ example: 54300 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  tarifaMartes?: number;

  @ApiPropertyOptional({ example: '08:00' })
  @IsOptional()
  @IsString()
  horaEntradaMartes?: string;

  @ApiPropertyOptional({ example: '14:00' })
  @IsOptional()
  @IsString()
  horaSalidaMartes?: string;

  @ApiPropertyOptional({ example: 54300 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  tarifaMiercoles?: number;

  @ApiPropertyOptional({ example: '08:00' })
  @IsOptional()
  @IsString()
  horaEntradaMiercoles?: string;

  @ApiPropertyOptional({ example: '14:00' })
  @IsOptional()
  @IsString()
  horaSalidaMiercoles?: string;

  @ApiPropertyOptional({ example: 54300 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  tarifaJueves?: number;

  @ApiPropertyOptional({ example: '08:00' })
  @IsOptional()
  @IsString()
  horaEntradaJueves?: string;

  @ApiPropertyOptional({ example: '14:00' })
  @IsOptional()
  @IsString()
  horaSalidaJueves?: string;

  @ApiPropertyOptional({ example: 68400 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  tarifaViernes?: number;

  @ApiPropertyOptional({ example: '08:00' })
  @IsOptional()
  @IsString()
  horaEntradaViernes?: string;

  @ApiPropertyOptional({ example: '14:00' })
  @IsOptional()
  @IsString()
  horaSalidaViernes?: string;

  @ApiPropertyOptional({ example: 60000 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  tarifaSabado?: number;

  @ApiPropertyOptional({ example: '08:00' })
  @IsOptional()
  @IsString()
  horaEntradaSabado?: string;

  @ApiPropertyOptional({ example: '14:00' })
  @IsOptional()
  @IsString()
  horaSalidaSabado?: string;

  @ApiPropertyOptional({ example: 60000 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  tarifaDomingo?: number;

  @ApiPropertyOptional({ example: '08:00' })
  @IsOptional()
  @IsString()
  horaEntradaDomingo?: string;

  @ApiPropertyOptional({ example: '14:00' })
  @IsOptional()
  @IsString()
  horaSalidaDomingo?: string;

  @ApiPropertyOptional({ example: 8000, description: 'Descuento si el empleado cena' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  descuentoCena?: number;

  @ApiPropertyOptional({ example: 60, description: 'Duración del descanso en minutos' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  duracionDescansoMinutos?: number;
}

export class UpdateCargoDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  nombre?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  tarifaLunes?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  horaEntradaLunes?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  horaSalidaLunes?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  tarifaMartes?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  horaEntradaMartes?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  horaSalidaMartes?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  tarifaMiercoles?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  horaEntradaMiercoles?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  horaSalidaMiercoles?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  tarifaJueves?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  horaEntradaJueves?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  horaSalidaJueves?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  tarifaViernes?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  horaEntradaViernes?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  horaSalidaViernes?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  tarifaSabado?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  horaEntradaSabado?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  horaSalidaSabado?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  tarifaDomingo?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  horaEntradaDomingo?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  horaSalidaDomingo?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  descuentoCena?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  duracionDescansoMinutos?: number;
}

export class CreateExcepcionHorarioDto {
  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  cargoId: string;

  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  fecha: string;

  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  nombre: string;

  @ApiProperty()
  @IsNotEmpty()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  tarifa: number;

  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  horaEntrada: string;

  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  horaSalida: string;
}
