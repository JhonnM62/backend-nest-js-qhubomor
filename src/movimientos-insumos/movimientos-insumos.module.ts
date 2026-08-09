import { Module } from '@nestjs/common';
import { MovimientosInsumosController } from './movimientos-insumos.controller';
import { MovimientosInsumosService } from './movimientos-insumos.service';
import { WebsocketModule } from '../websocket/websocket.module';

@Module({
  imports: [WebsocketModule],
  controllers: [MovimientosInsumosController],
  providers: [MovimientosInsumosService]
})
export class MovimientosInsumosModule {}
