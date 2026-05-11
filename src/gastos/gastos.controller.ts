import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { GastosService } from './gastos.service';
import { CreateGastoDto, UpdateGastoDto, GastosQueryDto } from './dto/gasto.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

@ApiTags('Gastos')
@Controller('gastos')
export class GastosController {
  constructor(private readonly gastosService: GastosService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Crear gasto' })
  create(@Body() createGastoDto: CreateGastoDto) {
    return this.gastosService.create(createGastoDto);
  }

  @Get()
  @ApiOperation({ summary: 'Obtener gastos' })
  findAll(@Query() query: GastosQueryDto) {
    return this.gastosService.findAll(query);
  }

  @Get('total')
  @ApiOperation({ summary: 'Obtener total de gastos en rango de fechas' })
  getTotalGastos(
    @Query('fechaDesde') fechaDesde: string,
    @Query('fechaHasta') fechaHasta: string,
  ) {
    return this.gastosService.getTotalGastos(new Date(fechaDesde), new Date(fechaHasta));
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obtener gasto por ID' })
  findOne(@Param('id') id: string) {
    return this.gastosService.findOne(id);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Actualizar gasto' })
  update(@Param('id') id: string, @Body() updateGastoDto: UpdateGastoDto) {
    return this.gastosService.update(id, updateGastoDto);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Eliminar gasto' })
  remove(@Param('id') id: string) {
    return this.gastosService.remove(id);
  }
}
