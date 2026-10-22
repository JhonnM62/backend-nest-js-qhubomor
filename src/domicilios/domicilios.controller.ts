import { Controller, Post, Get, Patch, Body, Param, Query, Headers, UseGuards, Request } from '@nestjs/common';
import { DomiciliosService } from './domicilios.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

@Controller('domicilios')
export class DomiciliosController {
  constructor(private readonly domiciliosService: DomiciliosService) {}

  /**
   * Endpoint de Webhook que recibe las notificaciones de pedidos desde wa-queue-api-v2.
   * No requiere JWT de usuario (se autentica por x-webhook-token).
   */
  @Post('webhook')
  async webhook(
    @Body() payload: any,
    @Headers('x-webhook-token') webhookToken?: string,
  ) {
    return this.domiciliosService.handleWebhook(payload, webhookToken);
  }

  /**
   * Lista todos los pedidos de domicilios (para la pestaña "Domis" en la app).
   */
  @Get()
  @UseGuards(JwtAuthGuard)
  async findAll(@Query('estado') estado?: string) {
    return this.domiciliosService.findAll(estado);
  }

  /**
   * Obtiene un domicilio por su ID.
   */
  @Get(':id')
  @UseGuards(JwtAuthGuard)
  async findOne(@Param('id') id: string) {
    return this.domiciliosService.findOne(id);
  }

  /**
   * Actualiza el estado de un domicilio (TOMADO, EN_PREPARACION, DESPACHADO, CANCELADO).
   */
  @Patch(':id/estado')
  @UseGuards(JwtAuthGuard)
  async updateEstado(
    @Param('id') id: string,
    @Body('estado') estado: string,
    @Request() req: any,
  ) {
    const atendidoPor = req.user?.nombre || req.user?.email || 'Empleado';
    return this.domiciliosService.updateEstado(id, estado, atendidoPor);
  }

  /**
   * Vincula una venta de caja generada al domicilio una vez cobrado.
   */
  @Post(':id/vincular-venta')
  @UseGuards(JwtAuthGuard)
  async vincularVenta(
    @Param('id') id: string,
    @Body('ventaId') ventaId: string,
  ) {
    return this.domiciliosService.vincularVenta(id, ventaId);
  }
}
