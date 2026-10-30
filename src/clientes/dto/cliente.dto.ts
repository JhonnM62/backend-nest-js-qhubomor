import { IsOptional, IsString, IsNumber, IsNotEmpty, IsIn, IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
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

export class CapturaEvidenciaDto {
  @ApiProperty({ description: 'Plataforma de la captura', enum: ['INSTAGRAM', 'TIKTOK', 'FACEBOOK', 'GOOGLE_MAPS'] })
  @IsNotEmpty()
  @IsIn(['INSTAGRAM', 'TIKTOK', 'FACEBOOK', 'GOOGLE_MAPS'])
  plataforma: 'INSTAGRAM' | 'TIKTOK' | 'FACEBOOK' | 'GOOGLE_MAPS';

  @ApiProperty({ description: 'Contenido de la imagen en base64' })
  @IsNotEmpty()
  @IsString()
  base64: string;
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

  @ApiPropertyOptional({ description: 'Capturas de evidencia para validación por IA', type: [CapturaEvidenciaDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CapturaEvidenciaDto)
  capturas?: CapturaEvidenciaDto[];
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

export class EliminarCuentaFidelidadDto {
  @ApiProperty({ description: 'Email del usuario a eliminar' })
  @IsNotEmpty()
  @IsString()
  email: string;

  @ApiPropertyOptional({ description: 'Código del cliente si se conoce' })
  @IsOptional()
  @IsNumber()
  codigoCliente?: number;
}

export class ActualizarCedulaWebDto {
  @ApiProperty({ description: 'Código único (IDcliente) o email del cliente' })
  @IsNotEmpty()
  @IsString()
  identificador: string;

  @ApiProperty({ description: 'Número de cédula único para vincular' })
  @IsNotEmpty()
  @IsString()
  cedula: string;
}

export class ClienteExternoDto {
  @ApiPropertyOptional({ description: 'Cédula del cliente' })
  @IsOptional()
  @IsString()
  cedula?: string;

  @ApiPropertyOptional({ description: 'Teléfono o WhatsApp' })
  @IsOptional()
  @IsString()
  telefono?: string;

  @ApiPropertyOptional({ description: 'Nombre del cliente' })
  @IsOptional()
  @IsString()
  nombre?: string;
}

export class SincronizarCompraExternaDto {
  @ApiProperty({ description: 'ID de la venta en el sistema externo' })
  @IsNotEmpty()
  @IsString()
  ventaIdExterna: string;

  @ApiProperty({ description: 'Acción realizada: PAGADO o ANULADO', enum: ['PAGADO', 'ANULADO'] })
  @IsNotEmpty()
  @IsIn(['PAGADO', 'ANULADO'])
  accion: 'PAGADO' | 'ANULADO';

  @ApiProperty({ description: 'Datos del cliente para vincular' })
  @ValidateNested()
  @Type(() => ClienteExternoDto)
  cliente: ClienteExternoDto;

  @ApiProperty({ description: 'Cantidad de platos válidos facturados (sin contar empaques ni $0)' })
  @IsNumber()
  platosValidos: number;

  @ApiPropertyOptional({ description: 'Origen del sistema (ej. restaurante2, fogata)' })
  @IsOptional()
  @IsString()
  origen?: string;
}

export class VincularIdentificadorDto {
  @ApiProperty({ description: 'Email del usuario autenticado en la web' })
  @IsNotEmpty()
  @IsString()
  email: string;

  @ApiProperty({ description: 'Número de WhatsApp, celular o cédula a vincular' })
  @IsNotEmpty()
  @IsString()
  identificador: string;

  @ApiPropertyOptional({ description: 'Nombre del usuario' })
  @IsOptional()
  @IsString()
  nombre?: string;
}
