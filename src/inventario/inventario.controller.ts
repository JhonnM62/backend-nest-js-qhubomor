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
import { InventarioService } from './inventario.service';
import { CreateInventarioDto, UpdateInventarioDto, CreateOrderInventarioDto, UpdateOrderInventarioDto, InventarioQueryDto, OrderInventarioQueryDto } from './dto/inventario.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

@ApiTags('Inventario')
@Controller('inventario')
export class InventarioController {
  constructor(private readonly inventarioService: InventarioService) {
    console.log('✅ InventarioController Inicializado - VERSIÓN CON RUTAS PATCH CORREGIDAS');
  }

  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Crear inventario' })
  create(@Body() createInventarioDto: CreateInventarioDto) {
    return this.inventarioService.create(createInventarioDto);
  }

  @Get()
  @ApiOperation({ summary: 'Obtener inventarios' })
  findAll(@Query() query: InventarioQueryDto) {
    return this.inventarioService.findAll(query);
  }

  @Get('items')
  @ApiOperation({ summary: 'Obtener todos los items de orden inventario' })
  findAllOrdenes(@Query() query: OrderInventarioQueryDto) {
    return this.inventarioService.findAllOrdenes(query);
  }

  @Get('bajo')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Obtener items con stock bajo' })
  getInventarioBajo() {
    return this.inventarioService.getInventarioBajo();
  }

  @Patch('item/:id/update')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Actualizar item del inventario' })
  updateItem(@Param('id') id: string, @Body() updateOrderDto: UpdateOrderInventarioDto) {
    console.log(`[InventarioController] PATCH /inventario/item/${id}/update`, updateOrderDto);
    return this.inventarioService.updateItem(id, updateOrderDto);
  }

  @Patch('item/update/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Actualizar item del inventario (Legacy)' })
  updateItemLegacy(@Param('id') id: string, @Body() updateOrderDto: UpdateOrderInventarioDto) {
    console.log(`[InventarioController] PATCH /inventario/item/update/${id} (Legacy)`, updateOrderDto);
    return this.inventarioService.updateItem(id, updateOrderDto);
  }

  @Patch('item/update')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  updateItemMissingId(@Body() updateOrderDto: any) {
    console.log(`[InventarioController] PATCH /inventario/item/update (FALTA EL ID!)`, updateOrderDto);
    throw new Error('Falta el ID del item a actualizar. Revisa el frontend.');
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obtener inventario por ID' })
  findOne(@Param('id') id: string) {
    return this.inventarioService.findOne(id);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Actualizar inventario' })
  update(@Param('id') id: string, @Body() updateInventarioDto: UpdateInventarioDto) {
    return this.inventarioService.update(id, updateInventarioDto);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Eliminar inventario' })
  remove(@Param('id') id: string, @Query('restoreStock') restoreStock?: string) {
    const shouldRestore = restoreStock !== 'false';
    return this.inventarioService.remove(id, shouldRestore);
  }

  @Post('item')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Agregar item al inventario' })
  agregarItem(@Body() createOrderDto: CreateOrderInventarioDto) {
    return this.inventarioService.agregarItem(createOrderDto);
  }

  @Delete('item/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Eliminar item del inventario' })
  eliminarItem(@Param('id') id: string, @Query('restoreStock') restoreStock?: string) {
    const shouldRestore = restoreStock !== 'false';
    return this.inventarioService.eliminarItem(id, shouldRestore);
  }

  @Patch('item/:id/comprar')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Marcar item como comprado' })
  marcarComprado(@Param('id') id: string) {
    return this.inventarioService.marcarComprado(id);
  }

  @Patch('items/comprar')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Marcar múltiples items como comprados' })
  marcarVariosComprado(@Body() body: { ids: string[] }) {
    return this.inventarioService.marcarVariosComprado(body.ids);
  }

  @Post('recalcular-stock')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Recalcular stock de insumos basado en órdenes de inventario' })
  recalcularStock() {
    return this.inventarioService.recalcularStockInsumos();
  }
}
