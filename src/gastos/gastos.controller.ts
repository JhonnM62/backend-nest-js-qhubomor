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
import { memoryStorage } from 'multer';
import { extname, join } from 'path';
import * as fs from 'fs';
// @ts-ignore
import * as sharp from 'sharp';
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
    storage: memoryStorage(),
    fileFilter: (req, file, cb) => {
      if (!file.mimetype.match(/\/(jpg|jpeg|png|gif|webp|avif|pdf)$/)) {
        return cb(new BadRequestException('Solo se permiten archivos de imagen o pdf'), false);
      }
      cb(null, true);
    },
    limits: {
      fileSize: 10 * 1024 * 1024, // 10MB
    },
  }))
  async uploadImage(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('Ningún archivo fue subido');
    }

    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const destFolder = process.env.NODE_ENV === 'production' 
      ? '/app/public/uploads/gastos' 
      : './public/uploads/gastos';

    // Crear carpeta si no existe (por precaución)
    if (!fs.existsSync(destFolder)) {
      fs.mkdirSync(destFolder, { recursive: true });
    }

    let finalFilename = `${uniqueSuffix}${extname(file.originalname)}`;

    // Procesar imágenes con sharp a formato AVIF (ultra ligero) o WebP
    if (file.mimetype.match(/\/(jpg|jpeg|png|webp|avif)$/)) {
      finalFilename = `${uniqueSuffix}.webp`; // Guardamos en webp para máxima compatibilidad
      const filePath = join(destFolder, finalFilename);
      await sharp(file.buffer)
        .resize({ width: 1280, withoutEnlargement: true }) // Redimensionar si es muy grande
        .webp({ quality: 75, effort: 6 }) // Convertir a WebP ultra ligero
        .toFile(filePath);
    } else {
      // Es un PDF u otro formato
      const filePath = join(destFolder, finalFilename);
      fs.writeFileSync(filePath, file.buffer);
    }

    return {
      message: 'Archivo subido y optimizado correctamente',
      imageUrl: `/uploads/gastos/${finalFilename}`,
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
