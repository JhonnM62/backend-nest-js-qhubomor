import { Module, forwardRef } from '@nestjs/common';
import { ClientesController } from './clientes.controller';
import { ClientesService } from './clientes.service';
import { PartnerSyncService } from './partner-sync.service';
import { WebsocketModule } from '../websocket/websocket.module';
import { AiModule } from '../ai/ai.module';
import { VentasModule } from '../ventas/ventas.module';

@Module({
  imports: [WebsocketModule, forwardRef(() => AiModule), forwardRef(() => VentasModule)],
  controllers: [ClientesController],
  providers: [ClientesService, PartnerSyncService],
  exports: [ClientesService, PartnerSyncService],
})
export class ClientesModule {}
