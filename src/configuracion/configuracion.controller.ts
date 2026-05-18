import { Controller, Get, Put, Body, UseGuards } from '@nestjs/common';
import { ConfiguracionService } from './configuracion.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';

@Controller('configuracion')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ConfiguracionController {
  constructor(private readonly configuracionService: ConfiguracionService) {}

  @Get()
  async getConfiguracion() {
    return this.configuracionService.getConfiguracion();
  }

  @Put()
  @Roles('Admin app', 'Admin negocio')
  async updateConfiguracion(@Body('horaCorteDia') horaCorteDia: string) {
    return this.configuracionService.updateConfiguracion(horaCorteDia);
  }

  // --- CONFIGURACION IA ---
  @Get('ia')
  @Roles('Admin app', 'Admin negocio')
  async getConfiguracionIA() {
    return this.configuracionService.getConfiguracionIA();
  }

  @Put('ia')
  @Roles('Admin app', 'Admin negocio')
  async updateConfiguracionIA(@Body() data: {
    apiKey?: string;
    modeloDefecto?: string;
    temperatura?: number;
    topP?: number;
    maxTokens?: number;
    isActive?: boolean;
  }) {
    return this.configuracionService.updateConfiguracionIA(data);
  }
}
