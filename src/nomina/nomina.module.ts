import { Module } from '@nestjs/common';
import { NominaController } from './nomina.controller';
import { NominaService } from './nomina.service';
import { PrismaModule } from '../prisma/prisma.module';
import { WebsocketModule } from '../websocket/websocket.module';
import { ConfiguracionModule } from '../configuracion/configuracion.module';
import { TurnosNotifierService } from './turnos-notifier.service';

@Module({
  imports: [PrismaModule, WebsocketModule, ConfiguracionModule],
  controllers: [NominaController],
  providers: [NominaService, TurnosNotifierService],
  exports: [NominaService],
})
export class NominaModule {}
