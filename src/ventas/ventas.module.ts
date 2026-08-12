import { Module } from '@nestjs/common';
import { VentasController } from './ventas.controller';
import { VentasService } from './ventas.service';
import { InsumosModule } from '../insumos/insumos.module';
import { WebsocketModule } from '../websocket/websocket.module';
import { FacturacionModule } from '../facturacion/facturacion.module';

@Module({
  imports: [InsumosModule, WebsocketModule, FacturacionModule],
  controllers: [VentasController],
  providers: [VentasService],
  exports: [VentasService],
})
export class VentasModule {}
