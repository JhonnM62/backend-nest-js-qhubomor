import { Controller, Get, Put, Body, UseGuards, Post, UseInterceptors, UploadedFile, BadRequestException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';
import * as fs from 'fs';
import { ConfiguracionService } from './configuracion.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
const Jimp = require('jimp');

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
    latitudNegocio?: number;
    longitudNegocio?: number;
    radioGeocercaM?: number;
    radioGeocercaDescansoM?: number;
    minutosGraciaLlegadaTarde?: number;
    emitirFacturaAutomatica?: boolean;
    factusEmail?: string;
    factusPassword?: string;
    factusClientId?: string;
    factusClientSecret?: string;
    factusMunicipioCodigo?: string;
    factusEntorno?: string;
    logoUrl?: string;
    imprimirLogo?: boolean;
    logoSize58?: number;
    logoSize80?: number;
    opcionesPropina?: any;
    opcionesDescuento?: any;
    habilitarPropinas?: boolean;
    habilitarDescuentos?: boolean;
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
    usarRazonamiento?: boolean;
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

  @Post('whatsapp/test-conexion')
  @Roles('Admin app', 'Admin negocio')
  async testWhatsappConexion(@Body() body: { usuarioId: string }) {
    if (!body.usuarioId) {
      throw new BadRequestException('Se requiere usuarioId');
    }
    return this.configuracionService.testWhatsappConexion(body.usuarioId);
  }

  @Get('whatsapp/empleados-para-prueba')
  @Roles('Admin app', 'Admin negocio')
  async getEmpleadosParaPrueba() {
    return this.configuracionService.getEmpleadosParaPrueba();
  }

  @Post('logo')
  @Roles('Admin app', 'Admin negocio')
  @UseInterceptors(
    FileInterceptor('logo', {
      storage: diskStorage({
        destination: (req, file, cb) => {
          const isProd = process.env.NODE_ENV === 'production';
          const uploadPath = isProd ? '/app/public/uploads/logos' : './public/uploads/logos';
          if (!fs.existsSync(uploadPath)) {
            fs.mkdirSync(uploadPath, { recursive: true });
          }
          cb(null, uploadPath);
        },
        filename: (req, file, cb) => {
          const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
          cb(null, `logo-${uniqueSuffix}${extname(file.originalname)}`);
        },
      }),
      fileFilter: (req, file, cb) => {
        if (!file.mimetype.match(/\/(jpg|jpeg|png|bmp|gif)$/)) {
          return cb(new BadRequestException('Solo se permiten imágenes'), false);
        }
        cb(null, true);
      }
    }),
  )
  async uploadLogo(
    @UploadedFile() file: Express.Multer.File,
    @Body() body: { baseUrl: string },
  ) {
    if (!file) throw new BadRequestException('La imagen es requerida');
    
    try {
      // Convertir la imagen a blanco y negro (monocromática) usando Jimp
      // Esto es crucial para la eficiencia en las impresoras térmicas ESC/POS
      const image = await Jimp.read(file.path);
      // Aplicar escala de grises y un contraste alto (1) para forzar blanco/negro puro
      image.greyscale().contrast(1);
      await image.writeAsync(file.path);
    } catch (error) {
      console.error('Error procesando imagen del logo con Jimp:', error);
      // Si falla, continuamos con la imagen original pero logueamos el error
    }

    const publicUrl = `${body.baseUrl.replace(/\/$/, '')}/uploads/logos/${file.filename}`;
    
    await this.configuracionService.updateConfiguracion({ logoUrl: publicUrl });
    
    return { success: true, url: publicUrl };
  }
}
