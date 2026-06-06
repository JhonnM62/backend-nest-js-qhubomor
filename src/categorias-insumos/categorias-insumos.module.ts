import { Module } from '@nestjs/common';
import { CategoriasInsumosService } from './categorias-insumos.service';
import { CategoriasInsumosController } from './categorias-insumos.controller';

@Module({
  controllers: [CategoriasInsumosController],
  providers: [CategoriasInsumosService],
})
export class CategoriasInsumosModule {}
