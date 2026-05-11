import { Controller, Get, Post, Body, Put, Param, UseGuards } from '@nestjs/common';
import { PrinterConfigService } from './printer-config.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

@Controller('printer-config')
@UseGuards(JwtAuthGuard)
export class PrinterConfigController {
  constructor(private readonly printerConfigService: PrinterConfigService) {}

  @Get()
  findAll() {
    return this.printerConfigService.findAll();
  }

  @Put()
  updateBulk(@Body() configs: { estadoOrden: string; imprimir: boolean }[]) {
    return this.printerConfigService.updateBulk(configs);
  }
}
