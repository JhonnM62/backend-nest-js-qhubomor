import { Test, TestingModule } from '@nestjs/testing';
import { MovimientosInsumosService } from './movimientos-insumos.service';

describe('MovimientosInsumosService', () => {
  let service: MovimientosInsumosService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [MovimientosInsumosService],
    }).compile();

    service = module.get<MovimientosInsumosService>(MovimientosInsumosService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
