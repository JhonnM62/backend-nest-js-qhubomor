import { Controller, Get, Post, Delete, Body, Param, Query, UseGuards, Request } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { ReportesService } from './reportes.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';

@ApiTags('Reportes')
@Controller('reportes')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
@Roles('Admin app') // Solo administradores
export class ReportesController {
  constructor(private readonly reportesService: ReportesService) {}

  @Get('dinero-guardado')
  @ApiOperation({ summary: 'Obtener lista de reportes (Filters)' })     
  getReportesDineroGuardado() {
    return this.reportesService.getReportesDineroGuardado();     
  }

  @Post('dinero-guardado')
  @ApiOperation({ summary: 'Crear un reporte de dinero guardado' })
  crearReporteDineroGuardado(
    @Body() body: { startDate: string; endDate: string }
  ) {
    return this.reportesService.crearReporteDineroGuardado(body.startDate, body.endDate);
  }

  @Delete('dinero-guardado/:filterId')
  @ApiOperation({ summary: 'Eliminar un reporte' })
  eliminarReporte(@Param('filterId') filterId: string) {
    return this.reportesService.eliminarReporte(filterId);
  }

  @Get('dinero-guardado/:filterId')
  @ApiOperation({ summary: 'Obtener detalle de reporte y sus retiros' }) 
  async getDetalleDineroGuardado(@Param('filterId') filterId: string) {
    const data = await this.reportesService.getDetalleDineroGuardado(filterId);
    console.log(`Detalle para ${filterId}:`, data.retiros.length, 'retiros encontrados');
    return data;
  }

  @Post('dinero-guardado/:filterId/retiros')
  @ApiOperation({ summary: 'Crear un retiro de la plata guardada' })
  crearRetiro(
    @Param('filterId') filterId: string,
    @Body() body: { retiroId: string; monto: number; observacion: string },
    @Request() req: any
  ) {
    // req.user viene del JwtAuthGuard
    return this.reportesService.crearRetiro(filterId, {
      ...body,
      usuario: req.user?.id
    });
  }

  @Delete('dinero-guardado/retiros/:retiroId')
  @ApiOperation({ summary: 'Eliminar un retiro' })
  eliminarRetiro(@Param('retiroId') retiroId: string) {
    return this.reportesService.eliminarRetiro(retiroId);
  }
}
