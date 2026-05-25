import { IsOptional, IsString, IsNumber, IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
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

export class CreateBulkGastoDto {
  @ApiProperty({ type: [CreateGastoDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateGastoDto)
  gastos: CreateGastoDto[];
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
