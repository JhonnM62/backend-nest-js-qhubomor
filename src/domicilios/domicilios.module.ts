import { Module } from '@nestjs/common';
import { DomiciliosController } from './domicilios.controller';
import { DomiciliosService } from './domicilios.service';
import { PrismaModule } from '../prisma/prisma.module';
import { AiModule } from '../ai/ai.module';
import { ConfiguracionModule } from '../configuracion/configuracion.module';
import { WebsocketModule } from '../websocket/websocket.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [PrismaModule, AiModule, ConfiguracionModule, WebsocketModule, NotificationsModule],
  controllers: [DomiciliosController],
  providers: [DomiciliosService],
  exports: [DomiciliosService],
})
export class DomiciliosModule {}
