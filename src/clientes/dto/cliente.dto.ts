import { IsOptional, IsString, IsNumber, IsNotEmpty, IsIn } from 'class-validator';
import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { PaginationDto } from '../../common/dto/pagination.dto';

export class CreateClienteDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  IDcliente?: number;

  @ApiPropertyOptional()
  @IsString()
  nombre?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  cedula?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  whatsapp?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  observaciones?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  compras?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  contador?: number;
}

export class UpdateClienteDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  nombre?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  cedula?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  whatsapp?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  observaciones?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  compras?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  contador?: number;
}

export class ClienteQueryDto extends PaginationDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  buscar?: string;
}

export class ReclamarMisionDto {
  @ApiProperty({ description: 'Código de cliente (máx 6 dígitos), Cédula o identificador' })
  @IsNotEmpty()
  @IsString()
  cedula: string;

  @ApiPropertyOptional({ description: 'Email del cliente registrado' })
  @IsOptional()
  @IsString()
  email?: string;

  @ApiPropertyOptional({ description: 'Nombre completo del cliente' })
  @IsOptional()
  @IsString()
  nombre?: string;

  @ApiPropertyOptional({ description: 'Número de WhatsApp' })
  @IsOptional()
  @IsString()
  whatsapp?: string;

  @ApiProperty({ description: 'Tipo de misión completada', enum: ['GOOGLE_REVIEW', 'REDES_SOCIALES'] })
  @IsNotEmpty()
  @IsIn(['GOOGLE_REVIEW', 'REDES_SOCIALES'])
  tipoMision: 'GOOGLE_REVIEW' | 'REDES_SOCIALES';
}

export class SincronizarUsuarioDto {
  @ApiProperty({ description: 'Email del usuario autenticado' })
  @IsNotEmpty()
  @IsString()
  email: string;

  @ApiPropertyOptional({ description: 'Nombre del usuario' })
  @IsOptional()
  @IsString()
  nombre?: string;
}
