import { Controller, Get, Put, Body, UseGuards } from '@nestjs/common';
import { ConfiguracionService } from './configuracion.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

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
}
