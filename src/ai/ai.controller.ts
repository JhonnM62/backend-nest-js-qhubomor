import { Controller, Post, Body, UseGuards, UseInterceptors, UploadedFile, BadRequestException, HttpCode, HttpStatus } from '@nestjs/common';
import { AiService } from './ai.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { ApiTags, ApiOperation, ApiConsumes, ApiBody } from '@nestjs/swagger';

@ApiTags('Inteligencia Artificial')
@Controller('ai')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AiController {
  constructor(private readonly aiService: AiService) {}

  @Post('extract-data')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Extrae información de una imagen usando IA' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
        },
        context: {
          type: 'string',
          description: 'Contexto de la extracción (ej. gastos)',
        },
      },
    },
  })
  @Roles('Admin app', 'Admin negocio', 'Empleado')
  @UseInterceptors(FileInterceptor('file', {
    storage: memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  }))
  async extractData(
    @UploadedFile() file: Express.Multer.File,
    @Body('context') context: string
  ) {
    if (!file) {
      throw new BadRequestException('No se proporcionó ninguna imagen.');
    }
    if (!context) {
      throw new BadRequestException('Se debe especificar un context (ej. "gastos").');
    }

    return this.aiService.extractDataFromImage(file.buffer, file.mimetype, context);
  }

  @Post('voice-order')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Procesa un audio para extraer un pedido con IA' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        audio: {
          type: 'string',
          format: 'binary',
        },
      },
    },
  })
  @Roles('Admin app', 'Admin negocio', 'Empleado')
  @UseInterceptors(FileInterceptor('audio', {
    storage: memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  }))
  async processVoiceOrder(
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('No se proporcionó ningún archivo de audio.');
    }

    return this.aiService.processVoiceOrder(file.buffer, file.mimetype);
  }
}
