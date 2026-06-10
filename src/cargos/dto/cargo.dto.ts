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

  @ApiPropertyOptional({ example: 54300 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  tarifaMartes?: number;

  @ApiPropertyOptional({ example: 54300 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  tarifaMiercoles?: number;

  @ApiPropertyOptional({ example: 54300 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  tarifaJueves?: number;

  @ApiPropertyOptional({ example: 68400 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  tarifaViernes?: number;

  @ApiPropertyOptional({ example: 60000 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  tarifaSabado?: number;

  @ApiPropertyOptional({ example: 60000 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  tarifaDomingo?: number;

  @ApiPropertyOptional({ example: 8000, description: 'Descuento si el empleado cena' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  descuentoCena?: number;
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
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  tarifaMartes?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  tarifaMiercoles?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  tarifaJueves?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  tarifaViernes?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  tarifaSabado?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  tarifaDomingo?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  descuentoCena?: number;
}
