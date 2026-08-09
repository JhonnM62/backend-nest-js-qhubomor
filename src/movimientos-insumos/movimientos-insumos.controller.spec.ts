import { Test, TestingModule } from '@nestjs/testing';
import { MovimientosInsumosController } from './movimientos-insumos.controller';

describe('MovimientosInsumosController', () => {
  let controller: MovimientosInsumosController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [MovimientosInsumosController],
    }).compile();

    controller = module.get<MovimientosInsumosController>(MovimientosInsumosController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
