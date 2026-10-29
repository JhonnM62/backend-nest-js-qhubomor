import { Module, forwardRef } from '@nestjs/common';
import { ClientesController } from './clientes.controller';
import { ClientesService } from './clientes.service';
import { WebsocketModule } from '../websocket/websocket.module';
import { AiModule } from '../ai/ai.module';
import { VentasModule } from '../ventas/ventas.module';

@Module({
  imports: [WebsocketModule, forwardRef(() => AiModule), forwardRef(() => VentasModule)],
  controllers: [ClientesController],
  providers: [ClientesService],
  exports: [ClientesService],
})
export class ClientesModule {}
