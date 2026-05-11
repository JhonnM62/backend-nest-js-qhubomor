import { IsString, IsOptional, IsNumber } from 'class-validator';

export class CreateComentarioDto {
  @IsString()
  comentarios: string;

  @IsOptional()
  @IsString()
  tipo?: string;

  @IsOptional()
  @IsNumber()
  precio?: number;
}

export class UpdateComentarioDto {
  @IsOptional()
  @IsString()
  comentarios?: string;

  @IsOptional()
  @IsString()
  tipo?: string;

  @IsOptional()
  @IsNumber()
  precio?: number;
}
