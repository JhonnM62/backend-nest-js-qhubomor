import { Module } from '@nestjs/common';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { ConfiguracionModule } from '../configuracion/configuracion.module';
import { PrismaModule } from '../prisma/prisma.module';
import { EstadisticasModule } from '../estadisticas/estadisticas.module';
import { AgentToolsService } from './agent.tools';
import { AgentService } from './agent.service';
import { AgentController } from './agent.controller';

@Module({
  imports: [ConfiguracionModule, PrismaModule, EstadisticasModule],
  controllers: [AiController, AgentController],
  providers: [AiService, AgentToolsService, AgentService],
  exports: [AiService, AgentService],
})
export class AiModule {}
