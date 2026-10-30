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
  Headers,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { ClientesService } from './clientes.service';
import { CreateClienteDto, UpdateClienteDto, ClienteQueryDto, ReclamarMisionDto, SincronizarUsuarioDto, EliminarCuentaFidelidadDto, ActualizarCedulaWebDto, SincronizarCompraExternaDto, VincularIdentificadorDto } from './dto/cliente.dto';
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
  
  @Public()
  @Post('fidelidad/vincular-identificador')
  @ApiOperation({ summary: 'Vincular WhatsApp o Cédula a la cuenta web unificando puntos si ya existían' })
  vincularIdentificador(@Body() dto: VincularIdentificadorDto) {
    return this.clientesService.vincularIdentificador(dto);
  }

  @Public()
  @Post('fidelidad/sincronizar-compra-externa')
  @ApiOperation({ summary: 'Sincronizar compras de comida realizadas en aplicaciones o restaurantes externos para sumar/restar sellos' })
  sincronizarCompraExterna(@Body() dto: SincronizarCompraExternaDto) {
    return this.clientesService.sincronizarCompraExterna(dto);
  }

  // ─── Endpoints de Sincronización Inter-POS (CRUD Completo de Clientes y Sellos) ───

  @Public()
  @Post('sync/upsert')
  @ApiOperation({ summary: 'Sincronizar creación o unificación de cliente entre comercios/apps' })
  syncUpsertCliente(
    @Body() dto: any,
    @Headers('x-sync-token') syncToken?: string,
    @Headers('x-sync-origin') syncOrigin?: string,
  ) {
    return this.clientesService.handleSyncUpsert(dto, syncOrigin);
  }

  @Public()
  @Patch('sync/:id')
  @ApiOperation({ summary: 'Sincronizar actualización de cliente entre comercios/apps' })
  syncUpdateCliente(
    @Param('id') id: string,
    @Body() dto: any,
    @Headers('x-sync-token') syncToken?: string,
    @Headers('x-sync-origin') syncOrigin?: string,
  ) {
    return this.clientesService.handleSyncUpdate(Number(id), dto, syncOrigin);
  }

  @Public()
  @Post('sync/sellos')
  @ApiOperation({ summary: 'Sincronizar sellos y fidelidad de cliente bidireccionalmente' })
  syncSellosCliente(
    @Body() dto: any,
    @Headers('x-sync-token') syncToken?: string,
    @Headers('x-sync-origin') syncOrigin?: string,
  ) {
    return this.clientesService.handleSyncSellos(dto, syncOrigin);
  }

  @Public()
  @Delete('sync/:id')
  @ApiOperation({ summary: 'Sincronizar eliminación/desactivación de cliente entre comercios/apps' })
  syncRemoveCliente(
    @Param('id') id: string,
    @Headers('x-sync-token') syncToken?: string,
    @Headers('x-sync-origin') syncOrigin?: string,
  ) {
    return this.clientesService.handleSyncRemove(Number(id), syncOrigin);
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
