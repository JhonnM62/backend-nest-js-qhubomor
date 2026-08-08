import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { EstadisticasService } from './estadisticas.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

@ApiTags('Estadisticas')
@Controller('estadisticas')
export class EstadisticasController {
  constructor(private readonly estadisticasService: EstadisticasService) {}

  @Get('generales')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Obtener estadísticas generales y gráficos' })
  @ApiQuery({ name: 'startDate', required: false, description: 'Fecha inicio (YYYY-MM-DD)' })
  @ApiQuery({ name: 'endDate', required: false, description: 'Fecha fin (YYYY-MM-DD)' })
  @ApiQuery({ name: 'categoriaProducto', required: false })
  @ApiQuery({ name: 'vendedorId', required: false })
  getEstadisticasGenerales(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('categoriaProducto') categoriaProducto?: string,
    @Query('vendedorId') vendedorId?: string,
  ) {
    return this.estadisticasService.getEstadisticasGenerales(startDate, endDate, categoriaProducto, vendedorId);
  }

  @Get('insumos-descuadres')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Obtener auditoría de descuadres de insumos por rango de fechas' })
  @ApiQuery({ name: 'startDate', required: true, description: 'Fecha inicio (YYYY-MM-DD)' })
  @ApiQuery({ name: 'endDate', required: true, description: 'Fecha fin (YYYY-MM-DD)' })
  getInsumosDescuadres(
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
  ) {
    return this.estadisticasService.getInsumosDescuadres(startDate, endDate);
  }
}
