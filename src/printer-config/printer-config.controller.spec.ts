import { Test, TestingModule } from '@nestjs/testing';
import { PrinterConfigController } from './printer-config.controller';

describe('PrinterConfigController', () => {
  let controller: PrinterConfigController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PrinterConfigController],
    }).compile();

    controller = module.get<PrinterConfigController>(PrinterConfigController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
