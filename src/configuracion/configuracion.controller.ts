import { Controller, Get, Put, Body, UseGuards, Post, UseInterceptors, UploadedFile, BadRequestException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';
import * as fs from 'fs';
import { ConfiguracionService } from './configuracion.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';

@Controller('configuracion')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ConfiguracionController {
  constructor(private readonly configuracionService: ConfiguracionService) {}

  @Get()
  async getConfiguracion() {
    return this.configuracionService.getConfiguracion();
  }

  @Put()
  @Roles('Admin app', 'Admin negocio')
  async updateConfiguracion(@Body() data: { 
    horaCorteDia?: string; 
    modoOperacion?: string;
    nombreComercial?: string;
    nit?: string;
    direccion?: string;
    telefono?: string;
  }) {
    return this.configuracionService.updateConfiguracion(data);
  }

  // --- CONFIGURACION IA ---
  @Get('ia')
  @Roles('Admin app', 'Admin negocio')
  async getConfiguracionIA() {
    return this.configuracionService.getConfiguracionIA();
  }

  @Put('ia')
  @Roles('Admin app', 'Admin negocio')
  async updateConfiguracionIA(@Body() data: {
    apiKey?: string;
    modeloDefecto?: string;
    temperatura?: number;
    topP?: number;
    maxTokens?: number;
    isActive?: boolean;
  }) {
    return this.configuracionService.updateConfiguracionIA(data);
  }

  // --- CONFIGURACION WHATSAPP ---
  @Get('whatsapp')
  @Roles('Admin app', 'Admin negocio')
  async getConfiguracionWhatsapp() {
    return this.configuracionService.getConfiguracionWhatsapp();
  }

  @Put('whatsapp')
  @Roles('Admin app', 'Admin negocio')
  async updateConfiguracionWhatsapp(@Body() data: {
    enabled?: boolean;
    urlBase?: string;
    sessionId?: string;
    token?: string;
    receiver?: string;
    isGroup?: boolean;
  }) {
    return this.configuracionService.updateConfiguracionWhatsapp(data);
  }

  @Post('whatsapp/send-report')
  @Roles('Admin app', 'Admin negocio', 'Empleado')
  async sendReportToWhatsapp(@Body() body: { urlPublica: string; fileName: string; caption: string }) {
    return this.configuracionService.sendReportToWhatsapp(body.urlPublica, body.fileName, body.caption);
  }

  @Post('whatsapp/upload-and-send')
  @Roles('Admin app', 'Admin negocio', 'Empleado')
  @UseInterceptors(
    FileInterceptor('pdf', {
      storage: diskStorage({
        destination: (req, file, cb) => {
          const isProd = process.env.NODE_ENV === 'production';
          const uploadPath = isProd ? '/app/public/uploads/pdf' : './public/uploads/pdf';
          if (!fs.existsSync(uploadPath)) {
            fs.mkdirSync(uploadPath, { recursive: true });
          }
          cb(null, uploadPath);
        },
        filename: (req, file, cb) => {
          const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
          cb(null, `reporte-${uniqueSuffix}${extname(file.originalname)}`);
        },
      }),
    }),
  )
  async uploadAndSendWhatsapp(
    @UploadedFile() file: Express.Multer.File,
    @Body() body: { fileName: string; caption: string; baseUrl: string },
  ) {
    if (!file) throw new BadRequestException('PDF es requerido');
    
    // El backend necesita saber su propio host para generar una URL pública, 
    // pero como no lo sabemos exactamente, usamos la url provista por el frontend
    const publicUrl = `${body.baseUrl.replace(/\/$/, '')}/uploads/pdf/${file.filename}`;
    return this.configuracionService.sendReportToWhatsapp(publicUrl, body.fileName, body.caption);
  }
}
