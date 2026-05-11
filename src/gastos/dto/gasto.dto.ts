import { IsOptional, IsString, IsNumber } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationDto } from '../../common/dto/pagination.dto';

export class CreateGastoDto {
  @ApiPropertyOptional()
  @IsString()
  concepto: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  valor?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  medioDePago?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  fotos?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  relacionConInsumos?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  tipo?: string;
}

export class UpdateGastoDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  concepto?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  valor?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  medioDePago?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  fotos?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  relacionConInsumos?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  tipo?: string;
}

export class GastosQueryDto extends PaginationDto {
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
  @IsString()
  tipo?: string;
}
