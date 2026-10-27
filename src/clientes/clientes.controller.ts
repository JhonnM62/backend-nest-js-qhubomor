import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { ClientesService } from './clientes.service';
import { CreateClienteDto, UpdateClienteDto, ClienteQueryDto, ReclamarMisionDto, SincronizarUsuarioDto } from './dto/cliente.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { Public } from '../common/decorators/public.decorator';

@ApiTags('Clientes')
@Controller('clientes')
export class ClientesController {
  constructor(private readonly clientesService: ClientesService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Crear cliente' })
  create(@Body() createClienteDto: CreateClienteDto) {
    return this.clientesService.create(createClienteDto);
  }

  @Get()
  @ApiOperation({ summary: 'Obtener clientes' })
  findAll(@Query() query: ClienteQueryDto) {
    return this.clientesService.findAll(query);
  }

  @Public()
  @Get('fidelidad/:identificador')
  @ApiOperation({ summary: 'Consultar tarjeta de fidelidad por Cédula o Código' })
  findFidelidad(@Param('identificador') identificador: string) {
    return this.clientesService.findFidelidad(identificador);
  }

  @Public()
  @Post('fidelidad/reclamar-mision')
  @ApiOperation({ summary: 'Acreditar sello por misión completada (Google Maps o Redes Sociales)' })
  reclamarMision(@Body() dto: ReclamarMisionDto) {
    return this.clientesService.reclamarMision(dto);
  }

  @Public()
  @Post('fidelidad/sincronizar-usuario')
  @ApiOperation({ summary: 'Obtener o generar código único de cliente de máx 6 dígitos al registrarse' })
  sincronizarUsuario(@Body() dto: SincronizarUsuarioDto) {
    return this.clientesService.sincronizarUsuario(dto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obtener cliente por ID' })
  findOne(@Param('id') id: string) {
    return this.clientesService.findOne(Number(id));
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Actualizar cliente' })
  update(@Param('id') id: string, @Body() updateClienteDto: UpdateClienteDto) {
    return this.clientesService.update(Number(id), updateClienteDto);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Eliminar cliente' })
  remove(@Param('id') id: string) {
    return this.clientesService.remove(Number(id));
  }
}
