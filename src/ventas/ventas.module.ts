import { Module, forwardRef } from '@nestjs/common';
import { VentasController } from './ventas.controller';
import { VentasService } from './ventas.service';
import { InsumosModule } from '../insumos/insumos.module';
import { WebsocketModule } from '../websocket/websocket.module';
import { FacturacionModule } from '../facturacion/facturacion.module';
import { ClientesModule } from '../clientes/clientes.module';

@Module({
  imports: [InsumosModule, WebsocketModule, FacturacionModule, forwardRef(() => ClientesModule)],
  controllers: [VentasController],
  providers: [VentasService],
  exports: [VentasService],
})
export class VentasModule {}
