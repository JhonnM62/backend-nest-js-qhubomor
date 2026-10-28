import { Module, forwardRef } from '@nestjs/common';
import { CajaController } from './caja.controller';
import { CajaService } from './caja.service';
import { WebsocketModule } from '../websocket/websocket.module';
import { AiModule } from '../ai/ai.module';

@Module({
  imports: [WebsocketModule, forwardRef(() => AiModule)],
  controllers: [CajaController],
  providers: [CajaService],
  exports: [CajaService],
})
export class CajaModule {}
