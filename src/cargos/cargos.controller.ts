import { Controller, Get, Post, Patch, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { CargosService } from './cargos.service';
import { CreateCargoDto, UpdateCargoDto } from './dto/cargo.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';

@ApiTags('Cargos Empleados')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('cargos')
export class CargosController {
  constructor(private readonly cargosService: CargosService) {}

  @Post()
  @Roles('Admin app', 'Admin negocio')
  create(@Body() dto: CreateCargoDto) {
    return this.cargosService.create(dto);
  }

  @Get()
  @Roles('Admin app', 'Admin negocio', 'Cajero', 'Jefe')
  findAll() {
    return this.cargosService.findAll();
  }

  @Get(':id')
  @Roles('Admin app', 'Admin negocio')
  findOne(@Param('id') id: string) {
    return this.cargosService.findOne(id);
  }

  @Patch(':id')
  @Roles('Admin app', 'Admin negocio')
  update(@Param('id') id: string, @Body() dto: UpdateCargoDto) {
    return this.cargosService.update(id, dto);
  }

  @Delete(':id')
  @Roles('Admin app', 'Admin negocio')
  remove(@Param('id') id: string) {
    return this.cargosService.remove(id);
  }
}
