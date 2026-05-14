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
  UseInterceptors,
  UploadedFile,
  BadRequestException
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiConsumes, ApiBody } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { GastosService } from './gastos.service';
import { CreateGastoDto, UpdateGastoDto, GastosQueryDto } from './dto/gasto.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

@ApiTags('Gastos')
@Controller('gastos')
export class GastosController {
  constructor(private readonly gastosService: GastosService) {}

  @Post('upload-image')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Subir comprobante de gasto' })
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
      destination: './public/uploads/gastos',
      filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
        const ext = extname(file.originalname);
        cb(null, `${uniqueSuffix}${ext}`);
      },
    }),
    fileFilter: (req, file, cb) => {
      if (!file.mimetype.match(/\/(jpg|jpeg|png|gif|webp|pdf)$/)) {
        return cb(new BadRequestException('Solo se permiten archivos de imagen o pdf'), false);
      }
      cb(null, true);
    },
    limits: {
      fileSize: 10 * 1024 * 1024, // 10MB
    },
  }))
  uploadImage(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('Ningún archivo fue subido');
    }
    return {
      message: 'Archivo subido correctamente',
      imageUrl: `/uploads/gastos/${file.filename}`,
    };
  }

  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Crear gasto' })
  create(@Body() createGastoDto: CreateGastoDto) {
    return this.gastosService.create(createGastoDto);
  }

  @Get()
  @ApiOperation({ summary: 'Obtener gastos' })
  findAll(@Query() query: GastosQueryDto) {
    return this.gastosService.findAll(query);
  }

  @Get('total')
  @ApiOperation({ summary: 'Obtener total de gastos en rango de fechas' })
  getTotalGastos(
    @Query('fechaDesde') fechaDesde: string,
    @Query('fechaHasta') fechaHasta: string,
  ) {
    return this.gastosService.getTotalGastos(new Date(fechaDesde), new Date(fechaHasta));
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obtener gasto por ID' })
  findOne(@Param('id') id: string) {
    return this.gastosService.findOne(id);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Actualizar gasto' })
  update(@Param('id') id: string, @Body() updateGastoDto: UpdateGastoDto) {
    return this.gastosService.update(id, updateGastoDto);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Eliminar gasto' })
  remove(@Param('id') id: string) {
    return this.gastosService.remove(id);
  }
}
