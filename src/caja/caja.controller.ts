import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Query,
  UseGuards,
  Delete,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { CajaService } from './caja.service';
import {
  CreateAperturaCierreCajaDto,
  UpdateCierreCajaDto,
  CajaQueryDto,
  RegistrarConteoDto
} from './dto/caja.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

@ApiTags('Caja')
@Controller('caja')
export class CajaController {
  constructor(private readonly cajaService: CajaService) {}

  @Post('abrir')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Abrir caja' })
  @ApiResponse({ status: 201, description: 'Caja abierta exitosamente' })
  abrirCaja(@Body() createCajaDto: CreateAperturaCierreCajaDto) {
    return this.cajaService.abrirCaja(createCajaDto);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Actualizar caja (edición genérica)' })
  updateCaja(@Param('id') id: string, @Body() updateDto: any) {
    return this.cajaService.updateCaja(id, updateDto);
  }

  @Patch('cerrar/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Cerrar caja' })
  @ApiResponse({ status: 200, description: 'Caja cerrada exitosamente' })
  cerrarCaja(@Param('id') id: string, @Body() updateCierreDto: UpdateCierreCajaDto) {
    return this.cajaService.cerrarCaja(id, updateCierreDto);
  }

  @Patch('reabrir/:id')
  @ApiOperation({ summary: 'Reabrir una caja cerrada por error (Solo Admin)' })
  @ApiResponse({ status: 200, description: 'Caja reabierta exitosamente.' })
  reabrirCaja(@Param('id') id: string) {
    return this.cajaService.reabrirCaja(id);
  }

  @Get('activa')
  @ApiOperation({ summary: 'Obtener caja activa' })
  @ApiResponse({ status: 200, description: 'Caja activa' })
  findCajaActiva() {
    return this.cajaService.findCajaActiva();
  }

  @Get('resumen/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Obtener resumen de caja' })
  @ApiResponse({ status: 200, description: 'Resumen de caja' })
  getResumenCaja(
    @Param('id') id: string,
    @Query('horaCorteSnapshot') horaCorteSnapshot?: string
  ) {
    return this.cajaService.getResumenCaja(id, horaCorteSnapshot);
  }

  @Get()
  @ApiOperation({ summary: 'Obtener todas las cajas' })
  @ApiResponse({ status: 200, description: 'Lista de cajas' })
  findAll(@Query() query: CajaQueryDto) {
    return this.cajaService.findAll(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obtener una caja por ID' })
  @ApiResponse({ status: 200, description: 'Caja encontrada' })
  @ApiResponse({ status: 404, description: 'Caja no encontrada' })
  findOne(@Param('id') id: string) {
    return this.cajaService.findOne(id);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Eliminar caja' })
  @ApiResponse({ status: 200, description: 'Caja eliminada exitosamente' })
  remove(@Param('id') id: string) {
    return this.cajaService.remove(id);
  }

  @Get(':id/verificacion-pendiente')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Obtener insumos pendientes de verificacion en una caja' })
  getVerificacionPendiente(@Param('id') id: string) {
    return this.cajaService.getVerificacionPendiente(id);
  }

  @Post(':id/registrar-conteo')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Registrar conteo de insumos verificacion' })
  registrarConteo(@Param('id') id: string, @Body() dto: RegistrarConteoDto) {
    return this.cajaService.registrarConteo(id, dto);
  }

  @Post(':id/posponer-verificacion')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Posponer la verificacion de insumos (max 3 veces)' })
  posponerVerificacion(@Param('id') id: string) {
    return this.cajaService.posponerVerificacion(id);
  }

  @Delete(':id/insumo/:insumoId/conteo/:conteoIndex')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Eliminar un conteo específico de un insumo' })
  eliminarConteo(
    @Param('id') id: string,
    @Param('insumoId') insumoId: string,
    @Param('conteoIndex') conteoIndex: number
  ) {
    return this.cajaService.eliminarConteo(id, insumoId, Number(conteoIndex));
  }

  @Patch(':id/insumo/:insumoId/conteo/:conteoIndex')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Editar un conteo específico de un insumo' })
  editarConteo(
    @Param('id') id: string,
    @Param('insumoId') insumoId: string,
    @Param('conteoIndex') conteoIndex: number,
    @Body() body: { cantContada: number }
  ) {
    return this.cajaService.editarConteo(id, insumoId, Number(conteoIndex), body.cantContada);
  }

  @Post(':id/auto-cuadre/preview')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Obtener un plan de auto-cuadre con IA' })
  getAutoCuadrePreview(@Param('id') id: string) {
    return this.cajaService.getAutoCuadrePreview(id);
  }

  @Post(':id/auto-cuadre/execute')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Ejecutar un plan de auto-cuadre con IA' })
  executeAutoCuadre(@Param('id') id: string, @Body() planIA: any) {
    return this.cajaService.executeAutoCuadre(id, planIA);
  }
}
