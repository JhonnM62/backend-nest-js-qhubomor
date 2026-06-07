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

  @Post('extract-text')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Extrae información de un texto usando IA' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Texto a procesar' },
        context: { type: 'string', description: 'Contexto de la extracción (ej. inventario)' },
      },
    },
  })
  @Roles('Admin app', 'Admin negocio', 'Empleado')
  async extractDataFromText(
    @Body('text') text: string,
    @Body('context') context: string
  ) {
    if (!text) {
      throw new BadRequestException('No se proporcionó ningún texto.');
    }
    if (!context) {
      throw new BadRequestException('Se debe especificar un context (ej. "inventario").');
    }

    return this.aiService.extractDataFromText(text, context);
  }

  @Post('refine-extraction')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Refina una extracción previa usando instrucciones adicionales' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        previousData: { type: 'object', description: 'Datos extraídos previamente' },
        correctionPrompt: { type: 'string', description: 'Instrucción de corrección del usuario' },
        context: { type: 'string', description: 'Contexto de la extracción (ej. inventario)' },
      },
    },
  })
  @Roles('Admin app', 'Admin negocio', 'Empleado')
  async refineExtraction(
    @Body('previousData') previousData: any,
    @Body('correctionPrompt') correctionPrompt: string,
    @Body('context') context: string
  ) {
    if (!previousData) {
      throw new BadRequestException('No se proporcionaron los datos previos.');
    }
    if (!correctionPrompt) {
      throw new BadRequestException('No se proporcionó la instrucción de corrección.');
    }
    if (!context) {
      throw new BadRequestException('Se debe especificar un context (ej. "inventario").');
    }

    return this.aiService.refineExtraction(previousData, correctionPrompt, context);
  }
}
