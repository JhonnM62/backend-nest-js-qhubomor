import { Controller, Get, Post, Body, Patch, Param, Delete } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { MesasService } from './mesas.service';
import { CreateMesaDto } from './dto/create-mesa.dto';
import { UpdateMesaDto } from './dto/update-mesa.dto';

@ApiTags('Mesas')
@Controller('mesas')
export class MesasController {
  constructor(private readonly mesasService: MesasService) {}

  @Post()
  @ApiOperation({ summary: 'Crear una nueva mesa' })
  @ApiResponse({ status: 201, description: 'La mesa ha sido creada exitosamente.' })
  create(@Body() createMesaDto: CreateMesaDto) {
    return this.mesasService.create(createMesaDto);
  }

  @Get()
  @ApiOperation({ summary: 'Obtener todas las mesas' })
  @ApiResponse({ status: 200, description: 'Lista de mesas' })
  findAll() {
    return this.mesasService.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obtener una mesa por ID' })
  @ApiResponse({ status: 200, description: 'Mesa encontrada' })
  @ApiResponse({ status: 404, description: 'Mesa no encontrada' })
  findOne(@Param('id') id: string) {
    return this.mesasService.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Actualizar una mesa' })
  @ApiResponse({ status: 200, description: 'La mesa ha sido actualizada exitosamente.' })
  @ApiResponse({ status: 404, description: 'Mesa no encontrada' })
  update(@Param('id') id: string, @Body() updateMesaDto: UpdateMesaDto) {
    return this.mesasService.update(id, updateMesaDto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Eliminar una mesa' })
  @ApiResponse({ status: 200, description: 'La mesa ha sido eliminada exitosamente.' })
  @ApiResponse({ status: 404, description: 'Mesa no encontrada' })
  remove(@Param('id') id: string) {
    return this.mesasService.remove(id);
  }
}
