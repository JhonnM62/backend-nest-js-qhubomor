import { Module } from '@nestjs/common';
import { EstadisticasController } from './estadisticas.controller';
import { EstadisticasService } from './estadisticas.service';
import { PrismaModule } from '../prisma/prisma.module';
import { CajaModule } from '../caja/caja.module';

@Module({
  imports: [PrismaModule, CajaModule],
  controllers: [EstadisticasController],
  providers: [EstadisticasService],
  exports: [EstadisticasService]
})
export class EstadisticasModule {}
