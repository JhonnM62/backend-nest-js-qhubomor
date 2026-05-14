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
  Put,
  UseInterceptors,
  UploadedFile,
  BadRequestException
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiConsumes, ApiBody } from '@nestjs/swagger';
import { InsumosService } from './insumos.service';
import { CreateInsumoDto, UpdateInsumoDto, InsumoQueryDto, MovimientoInsumoDto, BulkInsumoDto } from './dto/insumo.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';

@ApiTags('Insumos')
@Controller('insumos')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class InsumosController {
  constructor(private readonly insumosService: InsumosService) {}

  @Post('upload-image')
  @UseGuards(RolesGuard)
  @Roles('Admin app', 'Admin negocio', 'Inventarista')
  @ApiOperation({ summary: 'Subir imagen para un insumo' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
        },
      },
    },
  })
  @UseInterceptors(FileInterceptor('file', {
    storage: diskStorage({
      destination: process.env.NODE_ENV === 'production' 
        ? '/app/public/uploads/insumos' 
        : './public/uploads/insumos',
      filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
        const ext = extname(file.originalname);
        cb(null, `${uniqueSuffix}${ext}`);
      },
    }),
    fileFilter: (req, file, cb) => {
      if (!file.mimetype.match(/\/(jpg|jpeg|png|gif|webp)$/)) {
        return cb(new BadRequestException('Solo se permiten archivos de imagen'), false);
      }
      cb(null, true);
    },
    limits: {
      fileSize: 5 * 1024 * 1024, // 5MB
    },
  }))
  uploadImage(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('Ningún archivo fue subido');
    }
    return {
      message: 'Imagen subida correctamente',
      imageUrl: `/uploads/insumos/${file.filename}`,
    };
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles('Admin app', 'Admin negocio', 'Inventarista')
  @ApiOperation({ summary: 'Crear un nuevo insumo' })
  create(@Body() createInsumoDto: CreateInsumoDto) {
    return this.insumosService.create(createInsumoDto);
  }

  @Get()
  @ApiOperation({ summary: 'Obtener lista de insumos con filtros' })
  findAll(@Query() query: InsumoQueryDto) {
    return this.insumosService.findAll(query);
  }

  @Get('alertas')
  @ApiOperation({ summary: 'Obtener alertas de stock crítico' })
  getAlertas() {
    return this.insumosService.getAlertas();
  }

  @Get('estadisticas')
  @ApiOperation({ summary: 'Obtener estadísticas del inventario' })
  getEstadisticas() {
    return this.insumosService.getEstadisticas();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obtener un insumo por ID' })
  findOne(@Param('id') id: string) {
    return this.insumosService.findOne(id);
  }

  @Get(':id/movimientos')
  @ApiOperation({ summary: 'Obtener movimientos de un insumo' })
  getMovimientos(@Param('id') id: string, @Query('limit') limit?: number) {
    return this.insumosService.getMovimientos(id, limit);
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles('Admin app', 'Admin negocio', 'Inventarista')
  @ApiOperation({ summary: 'Actualizar un insumo' })
  @Put(':id')
  async update(@Param('id') id: string, @Body() updateInsumoDto: UpdateInsumoDto) {
    console.log('[DEBUG] Petición PUT /insumos/:id recibida. ID:', id, 'Payload:', updateInsumoDto);
    return this.insumosService.update(id, updateInsumoDto);
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles('Admin app')
  @ApiOperation({ summary: 'Eliminar un insumo' })
  remove(@Param('id') id: string) {
    return this.insumosService.remove(id);
  }

  @Post(':id/movimiento')
  @UseGuards(RolesGuard)
  @Roles('Admin app', 'Admin negocio', 'Inventarista', 'Cocina')
  @ApiOperation({ summary: 'Registrar movimiento de stock' })
  movimientoStock(
    @Param('id') id: string,
    @Body() movimientoDto: MovimientoInsumoDto
  ) {
    console.log('[DEBUG] Petición POST /insumos/:id/movimiento recibida. ID:', id, 'Payload:', movimientoDto);
    return this.insumosService.movimientoStock(
      id,
      movimientoDto.tipo || 'ajuste',
      movimientoDto.cantidad || 0,
      movimientoDto.motivo || 'Sin observación'
    );
  }

  @Post('bulk')
  @UseGuards(RolesGuard)
  @Roles('Admin app', 'Admin negocio')
  @ApiOperation({ summary: 'Crear múltiples insumos' })
  bulkCreate(@Body() bulkDto: BulkInsumoDto) {
    return this.insumosService.bulkCreate(bulkDto.insumos);
  }

  @Post(':id/agregar')
  @UseGuards(RolesGuard)
  @Roles('Admin app', 'Admin negocio', 'Inventarista')
  @ApiOperation({ summary: 'Agregar stock a un insumo' })
  agregarStock(
    @Param('id') id: string,
    @Body() body: { cantidad: number; observacion?: string }
  ) {
    return this.insumosService.agregarStock(id, body.cantidad, body.observacion || 'Agregado manualmente');
  }

  @Post(':id/descontar')
  @UseGuards(RolesGuard)
  @Roles('Admin app', 'Admin negocio', 'Inventarista', 'Cocina')
  @ApiOperation({ summary: 'Descontar stock de un insumo' })
  descontarStock(
    @Param('id') id: string,
    @Body() body: { cantidad: number; observacion?: string }
  ) {
    return this.insumosService.descontarStock(id, body.cantidad, body.observacion || 'Descontado para producción/venta');
  }
}