import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Query,
  UseGuards,
  Delete,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { VentasService } from './ventas.service';
import { CreateVentaDto, CreateVentaCompletaDto, VentaQueryDto, AddProductosDto } from './dto/venta.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@ApiTags('Ventas')
@Controller('ventas')
export class VentasController {
  constructor(private readonly ventasService: VentasService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Crear una nueva venta' })
  @ApiResponse({ status: 201, description: 'Venta creada exitosamente' })
  create(@Body() createVentaDto: CreateVentaDto) {
    return this.ventasService.create(createVentaDto);
  }

  @Post('completa')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Crear venta completa con productos' })
  @ApiResponse({ status: 201, description: 'Venta completa creada' })
  createVentaCompleta(
    @Body() createVentaCompletaDto: CreateVentaCompletaDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.ventasService.createVentaCompleta(createVentaCompletaDto, user.id);
  }

  @Get()
  @ApiOperation({ summary: 'Obtener todas las ventas con paginación' })
  @ApiResponse({ status: 200, description: 'Lista de ventas' })
  findAll(@Query() query: VentaQueryDto) {
    return this.ventasService.findAll(query);
  }

  @Get('hoy')
  @ApiOperation({ summary: 'Obtener ventas del día' })
  @ApiResponse({ status: 200, description: 'Ventas de hoy' })
  findVentasHoy() {
    return this.ventasService.findVentasHoy();
  }

  @Get('mesa/:mesaId')
  @ApiOperation({ summary: 'Obtener ventas activas de una mesa' })
  @ApiResponse({ status: 200, description: 'Ventas de la mesa' })
  findByMesa(@Param('mesaId') mesaId: string) {
    return this.ventasService.findByMesa(mesaId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obtener una venta por ID' })
  @ApiResponse({ status: 200, description: 'Venta encontrada' })
  @ApiResponse({ status: 404, description: 'Venta no encontrada' })
  findOne(@Param('id') id: string) {
    return this.ventasService.findOne(id);
  }

  @Get(':id/tiempo-total')
  @ApiOperation({ summary: 'Calcular el tiempo total transcurrido del pedido' })
  @ApiResponse({ status: 200, description: 'Tiempo calculado' })
  calcularTiempoTotal(@Param('id') id: string) {
    return this.ventasService.calcularTiempoTotal(id);
  }

  @Patch(':id/estado')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Actualizar estado de una venta' })
  @ApiResponse({ status: 200, description: 'Estado actualizado' })
  updateEstado(@Param('id') id: string, @Body('estado') estado: string) {
    return this.ventasService.updateEstado(id, estado);
  }

  @Patch(':id/pago')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Actualizar información de pago y estado de una venta' })
  @ApiResponse({ status: 200, description: 'Pago actualizado' })
  updatePago(@Param('id') id: string, @Body() updateData: any) {
    return this.ventasService.updatePago(id, updateData);
  }

  @Post(':id/productos')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Agregar productos a una venta existente' })
  @ApiResponse({ status: 201, description: 'Productos agregados' })
  addProductos(@Param('id') id: string, @Body() addProductosDto: AddProductosDto) {
    return this.ventasService.addProductosToVenta(id, addProductosDto.productos);
  }

  @Delete('bulk')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('Admin app')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Eliminar múltiples ventas (Soft Delete)' })
  @ApiResponse({ status: 200, description: 'Ventas eliminadas correctamente' })
  removeBulk(@Body('ids') ids: string[], @Body('reason') reason: string, @CurrentUser() user: { id: string }) {
    return this.ventasService.removeBulk(ids, user.id, reason);
  }

  @Delete('trash/empty')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('Admin app')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Eliminar definitivamente todas las ventas de la papelera' })
  @ApiResponse({ status: 200, description: 'Papelera vaciada correctamente' })
  emptyTrash() {
    return this.ventasService.emptyTrash();
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('Admin app')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Eliminar una venta (Soft Delete)' })
  @ApiResponse({ status: 200, description: 'Venta eliminada correctamente' })
  remove(@Param('id') id: string, @Body('reason') reason: string, @CurrentUser() user: { id: string }) {
    return this.ventasService.remove(id, user.id, reason);
  }

  @Delete(':id/hard')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('Admin app')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Eliminar definitivamente una venta (Hard Delete)' })
  @ApiResponse({ status: 200, description: 'Venta eliminada permanentemente' })
  hardDelete(@Param('id') id: string) {
    return this.ventasService.hardDelete(id);
  }

  @Delete('bulk/hard')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('Admin app')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Eliminar definitivamente múltiples ventas (Bulk Hard Delete)' })
  @ApiResponse({ status: 200, description: 'Ventas eliminadas permanentemente' })
  hardDeleteBulk(@Body('ids') ids: string[]) {
    return this.ventasService.hardDeleteBulk(ids);
  }

  @Post(':id/restore')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('Admin app')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Restaurar una venta eliminada (Un-Delete)' })
  @ApiResponse({ status: 200, description: 'Venta restaurada correctamente' })
  restore(@Param('id') id: string) {
    return this.ventasService.restore(id);
  }
}
