import { Module } from '@nestjs/common';
import { SeccionCocinaController } from './seccion-cocina.controller';
import { SeccionCocinaService } from './seccion-cocina.service';
import { WebsocketModule } from '../websocket/websocket.module';

@Module({
  imports: [WebsocketModule],
  controllers: [SeccionCocinaController],
  providers: [SeccionCocinaService],
  exports: [SeccionCocinaService],
})
export class SeccionCocinaModule {}
