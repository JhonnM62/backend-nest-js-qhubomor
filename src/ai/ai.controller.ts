import { Controller, Post, Body, UseGuards, UseInterceptors, UploadedFile, BadRequestException } from '@nestjs/common';
import { AiService } from './ai.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';

@Controller('ai')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AiController {
  constructor(private readonly aiService: AiService) {}

  @Post('extract-data')
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
}
