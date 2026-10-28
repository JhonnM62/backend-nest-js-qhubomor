import { Module } from '@nestjs/common';
import { ClientesController } from './clientes.controller';
import { ClientesService } from './clientes.service';
import { WebsocketModule } from '../websocket/websocket.module';
import { AiModule } from '../ai/ai.module';

@Module({
  imports: [WebsocketModule, AiModule],
  controllers: [ClientesController],
  providers: [ClientesService],
  exports: [ClientesService],
})
export class ClientesModule {}
