import { Controller, Get, Post, Body, UseGuards, Request, Query } from '@nestjs/common';
import { MovimientosInsumosService } from './movimientos-insumos.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { AbrirPaqueteDto, DescuentoProduccionDto } from './dto/movimientos.dto';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';

@ApiTags('Movimientos Insumos')
@Controller('movimientos-insumos')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class MovimientosInsumosController {
  constructor(private readonly movimientosInsumosService: MovimientosInsumosService) {}

  @Get()
  @Roles('Admin app', 'Admin negocio', 'Inventarista')
  @ApiOperation({ summary: 'Obtener el historial de movimientos de insumos' })
  findAll(@Query() query: any) {
    return this.movimientosInsumosService.findAll(query);
  }

  @Post('abrir-paquete')
  @Roles('Admin app', 'Admin negocio', 'Cajero', 'Mesero')
  @ApiOperation({ summary: 'Reportar la apertura de un paquete y ajustar el stock' })
  abrirPaquete(@Body() dto: AbrirPaqueteDto, @Request() req: any) {
    const usuario = req.user?.username || req.user?.nombre || 'Usuario Desconocido';
    return this.movimientosInsumosService.abrirPaquete(dto, usuario);
  }

  @Post('descuento-produccion')
  @Roles('Admin app', 'Admin negocio', 'Cajero', 'Mesero', 'Cocina')
  @ApiOperation({ summary: 'Descontar stock manualmente (ej. producción)' })
  descuentoProduccion(@Body() dto: DescuentoProduccionDto, @Request() req: any) {
    const usuario = req.user?.username || req.user?.nombre || 'Usuario Desconocido';
    return this.movimientosInsumosService.descuentoProduccion(dto, usuario);
  }
}
