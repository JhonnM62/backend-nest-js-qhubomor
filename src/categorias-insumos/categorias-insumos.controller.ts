import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { CategoriasInsumosService } from './categorias-insumos.service';
import { CreateCategoriaInsumoDto, UpdateCategoriaInsumoDto } from './dto/categorias-insumos.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';

@ApiTags('Categorias-Insumos')
@Controller('categorias-insumos')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class CategoriasInsumosController {
  constructor(private readonly categoriasInsumosService: CategoriasInsumosService) {}

  @Post()
  @UseGuards(RolesGuard)
  @Roles('Admin app', 'Admin negocio', 'Inventarista')
  @ApiOperation({ summary: 'Crear una nueva categoría de insumo' })
  create(@Body() createDto: CreateCategoriaInsumoDto) {
    return this.categoriasInsumosService.create(createDto);
  }

  @Get()
  @ApiOperation({ summary: 'Listar todas las categorías de insumos' })
  findAll() {
    return this.categoriasInsumosService.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obtener una categoría de insumo por ID' })
  findOne(@Param('id') id: string) {
    return this.categoriasInsumosService.findOne(id);
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles('Admin app', 'Admin negocio', 'Inventarista')
  @ApiOperation({ summary: 'Actualizar una categoría de insumo' })
  update(@Param('id') id: string, @Body() updateDto: UpdateCategoriaInsumoDto) {
    return this.categoriasInsumosService.update(id, updateDto);
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles('Admin app')
  @ApiOperation({ summary: 'Eliminar una categoría de insumo' })
  remove(@Param('id') id: string) {
    return this.categoriasInsumosService.remove(id);
  }
}
