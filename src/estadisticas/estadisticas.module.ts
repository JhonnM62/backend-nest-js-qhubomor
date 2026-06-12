import { Module } from '@nestjs/common';
import { EstadisticasController } from './estadisticas.controller';
import { EstadisticasService } from './estadisticas.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [EstadisticasController],
  providers: [EstadisticasService],
  exports: [EstadisticasService]
})
export class EstadisticasModule {}
