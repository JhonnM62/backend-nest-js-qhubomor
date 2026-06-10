import { Module } from '@nestjs/common';
import { CargosController } from './cargos.controller';
import { CargosService } from './cargos.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [CargosController],
  providers: [CargosService],
  exports: [CargosService],
})
export class CargosModule {}
