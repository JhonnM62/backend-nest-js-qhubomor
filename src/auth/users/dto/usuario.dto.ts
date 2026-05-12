import { IsOptional, IsString, IsNumber, IsEmail, IsNotEmpty, MinLength, Matches } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class PaginationDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @IsNumber()
  page?: number = 1;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @IsNumber()
  limit?: number = 20;
}

export class CreateUsuarioDto {
  @ApiPropertyOptional()
  @IsNotEmpty({ message: 'El nombre es obligatorio' })
  @IsString()
  nombre: string;

  @ApiPropertyOptional()
  @IsNotEmpty({ message: 'El correo electrónico es obligatorio' })
  @IsEmail({}, { message: 'El correo electrónico no es válido' })
  email: string;

  @ApiPropertyOptional()
  @IsNotEmpty({ message: 'La contraseña es obligatoria' })
  @MinLength(8, { message: 'La contraseña debe tener al menos 8 caracteres' })
  @Matches(/^(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?])/, {
    message: 'La contraseña debe contener al menos una mayúscula, un número y un carácter especial',
  })
  password: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  cedula?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  telefono?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  direccion?: string;

  @ApiPropertyOptional()
  @IsNotEmpty({ message: 'El rol es obligatorio' })
  @IsString()
  rol: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  salario?: number;

  @ApiPropertyOptional()
  @IsOptional()
  permisos?: any;
}

export class UpdateUsuarioDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  nombre?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail({}, { message: 'El correo electrónico no es válido' })
  email?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  password?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  cedula?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  telefono?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  direccion?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  rol?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  salario?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  foto?: string;

  @ApiPropertyOptional()
  @IsOptional()
  permisos?: any;

  @ApiPropertyOptional()
  @IsOptional()
  isActive?: boolean;
}

export class UsuarioQueryDto extends PaginationDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  rol?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  buscar?: string;
}

export const ROLES_DISPONIBLES = [
  { key: 'Admin app', label: 'Admin App', description: 'Administrador de la aplicación' },
  { key: 'Cajero', label: 'Cajero', description: 'Encargado de caja y cobros' },
  { key: 'Mesero', label: 'Mesero', description: 'Toma pedidos y atiende mesas' },
  { key: 'Cocina', label: 'Cocina', description: 'Prepara los pedidos' },
  { key: 'Proveedor', label: 'Proveedor', description: 'Gestiona proveedores' },
  { key: 'Domiciliario', label: 'Domiciliario', description: 'Entrega pedidos a domicilio' },
  { key: 'Jefe', label: 'Jefe', description: 'Supervisa operaciones' },
  { key: 'Admin negocio', label: 'Admin Negocio', description: 'Administrador del negocio' },
  { key: 'Inventarista', label: 'Inventarista', description: 'Gestiona el inventario' },
];