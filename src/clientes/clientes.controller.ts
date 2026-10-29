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
import { CreateClienteDto, UpdateClienteDto, ClienteQueryDto, ReclamarMisionDto, SincronizarUsuarioDto, EliminarCuentaFidelidadDto, ActualizarCedulaWebDto, SincronizarCompraExternaDto } from './dto/cliente.dto';
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

  @Public()
  @Post('fidelidad/eliminar-cuenta')
  @ApiOperation({ summary: 'Eliminar cliente y sus sellos de fidelidad preservando las ventas' })
  eliminarCuentaFidelidad(@Body() dto: EliminarCuentaFidelidadDto) {
    return this.clientesService.eliminarCuentaFidelidad(dto);
  }

  @Public()
  @Post('fidelidad/actualizar-cedula')
  @ApiOperation({ summary: 'Vincular o actualizar número de cédula del cliente (editable solo una vez desde la web)' })
  actualizarCedulaWeb(@Body() dto: ActualizarCedulaWebDto) {
    return this.clientesService.actualizarCedulaWeb(dto);
  }

  @Public()
  @Post('fidelidad/sincronizar-compra-externa')
  @ApiOperation({ summary: 'Sincronizar compras de comida realizadas en aplicaciones o restaurantes externos para sumar/restar sellos' })
  sincronizarCompraExterna(@Body() dto: SincronizarCompraExternaDto) {
    return this.clientesService.sincronizarCompraExterna(dto);
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
