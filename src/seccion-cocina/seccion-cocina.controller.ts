import {
  Controller, Get, Post, Body, Patch, Param, Delete, UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { SeccionCocinaService } from './seccion-cocina.service';
import { CreateSeccionCocinaDto, UpdateSeccionCocinaDto } from './dto/seccion-cocina.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';

@ApiTags('Secciones Cocina')
@Controller('secciones-cocina')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class SeccionCocinaController {
  constructor(private readonly service: SeccionCocinaService) {}

  @Post()
  @UseGuards(RolesGuard)
  @Roles('Admin app', 'Admin negocio')
  @ApiOperation({ summary: 'Crear sección de cocina' })
  @ApiResponse({ status: 201, description: 'Sección creada' })
  create(@Body() dto: CreateSeccionCocinaDto) {
    return this.service.create(dto);
  }

  @Get()
  @ApiOperation({ summary: 'Listar secciones activas (ordenadas por orden)' })
  @ApiResponse({ status: 200, description: 'Lista de secciones' })
  findAll() {
    return this.service.findAll();
  }

  @Get('all')
  @ApiOperation({ summary: 'Listar todas las secciones incluyendo inactivas' })
  findAllIncludingInactive() {
    return this.service.findAllIncludingInactive();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obtener sección por ID (incluye productos asignados)' })
  @ApiResponse({ status: 200, description: 'Sección encontrada' })
  @ApiResponse({ status: 404, description: 'Sección no encontrada' })
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles('Admin app', 'Admin negocio')
  @ApiOperation({ summary: 'Actualizar sección' })
  @ApiResponse({ status: 200, description: 'Sección actualizada' })
  update(@Param('id') id: string, @Body() dto: UpdateSeccionCocinaDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles('Admin app', 'Admin negocio')
  @ApiOperation({ summary: 'Eliminar sección (desasocia productos automáticamente)' })
  @ApiResponse({ status: 200, description: 'Sección eliminada' })
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
