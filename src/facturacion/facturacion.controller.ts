import { Controller, Post, Param, UseGuards, Delete } from '@nestjs/common';
import { FacturacionService } from './facturacion.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';

@ApiTags('Facturacion')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('facturacion')
export class FacturacionController {
  constructor(private readonly facturacionService: FacturacionService) {}

  @Post('emitir/:ventaId')
  @ApiOperation({ summary: 'Emitir factura electrónica manualmente para una venta' })
  async emitirFactura(@Param('ventaId') ventaId: string) {
    return this.facturacionService.emitirFactura(ventaId);
  }

  @Delete(':ventaId')
  @ApiOperation({ summary: 'Eliminar factura electrónica de una venta (local y en Factus si no está validada)' })
  async eliminarFactura(@Param('ventaId') ventaId: string) {
    return this.facturacionService.eliminarFactura(ventaId);
  }
}
