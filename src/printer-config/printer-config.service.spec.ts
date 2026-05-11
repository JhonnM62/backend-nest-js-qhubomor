import { Test, TestingModule } from '@nestjs/testing';
import { PrinterConfigService } from './printer-config.service';

describe('PrinterConfigService', () => {
  let service: PrinterConfigService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PrinterConfigService],
    }).compile();

    service = module.get<PrinterConfigService>(PrinterConfigService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
