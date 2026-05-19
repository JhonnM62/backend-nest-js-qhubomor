import { Module } from '@nestjs/common';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { ConfiguracionModule } from '../configuracion/configuracion.module';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [ConfiguracionModule, PrismaModule],
  controllers: [AiController],
  providers: [AiService],
  exports: [AiService],
})
export class AiModule {}
