import { Module } from '@nestjs/common';
import { GastosController } from './gastos.controller';
import { GastosService } from './gastos.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { WebsocketModule } from '../websocket/websocket.module';

@Module({
  imports: [NotificationsModule, WebsocketModule],
  controllers: [GastosController],
  providers: [GastosService],
  exports: [GastosService],
})
export class GastosModule {}
