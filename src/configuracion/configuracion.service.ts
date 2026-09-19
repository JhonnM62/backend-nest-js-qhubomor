import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ConfiguracionService {
  constructor(private prisma: PrismaService) {}

  async getConfiguracion() {
    let config = await this.prisma.configuracionNegocio.findUnique({
      where: { id: 1 }
    });

    if (!config) {
      config = await this.prisma.configuracionNegocio.create({
        data: {
        id: 1,
        horaCorteDia: '00:00',
        modoOperacion: 'GENERAL'
      }
    });
  }

  return config;
}

async updateConfiguracion(data: { 
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
  return this.prisma.configuracionNegocio.upsert({
    where: { id: 1 },
    update: {
      horaCorteDia: data.horaCorteDia,
      modoOperacion: data.modoOperacion,
      nombreComercial: data.nombreComercial,
      nit: data.nit,
      direccion: data.direccion,
      telefono: data.telefono,
      latitudNegocio: data.latitudNegocio,
      longitudNegocio: data.longitudNegocio,
      radioGeocercaM: data.radioGeocercaM,
      radioGeocercaDescansoM: data.radioGeocercaDescansoM,
      minutosGraciaLlegadaTarde: data.minutosGraciaLlegadaTarde,
      emitirFacturaAutomatica: data.emitirFacturaAutomatica,
      factusEmail: data.factusEmail,
      factusPassword: data.factusPassword,
      factusClientId: data.factusClientId,
      factusClientSecret: data.factusClientSecret,
      factusMunicipioCodigo: data.factusMunicipioCodigo,
      factusEntorno: data.factusEntorno,
      logoUrl: data.logoUrl,
      imprimirLogo: data.imprimirLogo,
      logoSize58: data.logoSize58,
      logoSize80: data.logoSize80,
      opcionesPropina: data.opcionesPropina ? JSON.stringify(data.opcionesPropina) : undefined,
      opcionesDescuento: data.opcionesDescuento ? JSON.stringify(data.opcionesDescuento) : undefined,
      habilitarPropinas: data.habilitarPropinas,
      habilitarDescuentos: data.habilitarDescuentos
    },
    create: {
      id: 1,
      horaCorteDia: data.horaCorteDia || '00:00',
      modoOperacion: data.modoOperacion || 'GENERAL',
      nombreComercial: data.nombreComercial || 'Q HUBO MOR',
      nit: data.nit,
      direccion: data.direccion,
      telefono: data.telefono,
      latitudNegocio: data.latitudNegocio,
      longitudNegocio: data.longitudNegocio,
      radioGeocercaM: data.radioGeocercaM ?? 100,
      radioGeocercaDescansoM: data.radioGeocercaDescansoM ?? 50,
      minutosGraciaLlegadaTarde: data.minutosGraciaLlegadaTarde ?? 5,
      emitirFacturaAutomatica: data.emitirFacturaAutomatica || false,
      factusEmail: data.factusEmail,
      factusPassword: data.factusPassword,
      factusClientId: data.factusClientId,
      factusClientSecret: data.factusClientSecret,
      factusMunicipioCodigo: data.factusMunicipioCodigo || '52356',
      factusEntorno: data.factusEntorno || 'SANDBOX',
      logoUrl: data.logoUrl,
      imprimirLogo: data.imprimirLogo ?? true,
      logoSize58: data.logoSize58 ?? 50,
      logoSize80: data.logoSize80 ?? 50,
      opcionesPropina: data.opcionesPropina ? JSON.stringify(data.opcionesPropina) : '[5, 10, 15]',
      opcionesDescuento: data.opcionesDescuento ? JSON.stringify(data.opcionesDescuento) : '[5, 10, 20]',
      habilitarPropinas: data.habilitarPropinas !== undefined ? data.habilitarPropinas : true,
      habilitarDescuentos: data.habilitarDescuentos !== undefined ? data.habilitarDescuentos : true
    }
  });
}

  // --- CONFIGURACION IA ---
  async getConfiguracionIA() {
    let configIA = await this.prisma.configuracionIA.findUnique({
      where: { id: 1 }
    });

    if (!configIA) {
      configIA = await this.prisma.configuracionIA.create({
        data: {
          id: 1,
          modeloDefecto: 'gemini-3.5-flash',
          temperatura: 0.4,
          topP: 0.95,
          maxTokens: 8192,
          isActive: true,
          usarRazonamiento: false
        }
      });
    }

    return configIA;
  }

  async updateConfiguracionIA(data: {
    apiKey?: string;
    modeloDefecto?: string;
    temperatura?: number;
    topP?: number;
    maxTokens?: number;
    isActive?: boolean;
    usarRazonamiento?: boolean;
  }) {
    return this.prisma.configuracionIA.upsert({
      where: { id: 1 },
      update: data,
      create: {
        id: 1,
        modeloDefecto: 'gemini-3.5-flash',
        temperatura: 0.4,
        topP: 0.95,
        maxTokens: 8192,
        isActive: true,
        usarRazonamiento: false,
        ...data,
      }
    });
  }

  // --- CONFIGURACION WHATSAPP ---
  async getConfiguracionWhatsapp() {
    let configWhatsapp = await this.prisma.configuracionWhatsapp.findUnique({
      where: { id: 1 }
    });

    if (!configWhatsapp) {
      configWhatsapp = await this.prisma.configuracionWhatsapp.create({
        data: {
          id: 1,
          enabled: false,
          isGroup: false,
        }
      });
    }

    return configWhatsapp;
  }

  async updateConfiguracionWhatsapp(data: {
    enabled?: boolean;
    urlBase?: string;
    sessionId?: string;
    token?: string;
    receiver?: string;
    isGroup?: boolean;
  }) {
    return this.prisma.configuracionWhatsapp.upsert({
      where: { id: 1 },
      update: data,
      create: {
        id: 1,
        ...data,
      }
    });
  }

  async sendReportToWhatsapp(urlPublica: string, fileName: string, caption: string) {
    const config = await this.getConfiguracionWhatsapp();

    if (!config.enabled) {
      return { success: false, message: 'El envío por WhatsApp está deshabilitado en la configuración.' };
    }

    if (!config.urlBase || !config.sessionId || !config.token || !config.receiver) {
      return { success: false, message: 'Faltan parámetros en la configuración de WhatsApp.' };
    }

    const endpoint = `${config.urlBase.replace(/\/$/, '')}/chats/send?id=${config.sessionId}`;

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-access-token': config.token,
        },
        body: JSON.stringify({
          receiver: config.receiver,
          isGroup: config.isGroup,
          message: {
            document: {
              url: urlPublica,
            },
            caption: caption,
            mimetype: 'application/pdf',
            fileName: fileName,
          },
        }),
      });

      const responseData = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(responseData?.message || 'Error en la respuesta de la API de WhatsApp');
      }

      return { success: true, data: responseData };
    } catch (error: any) {
      console.error('[WhatsAppService] Error enviando mensaje:', error.message);
      throw new Error(`Error al enviar a WhatsApp: ${error.message}`);
    }
  }

  async sendTextToWhatsapp(receiverPhone: string, text: string) {
    const config = await this.getConfiguracionWhatsapp();

    if (!config.enabled) {
      return { success: false, message: 'El envío por WhatsApp está deshabilitado en la configuración.' };
    }

    if (!config.urlBase || !config.sessionId || !config.token) {
      return { success: false, message: 'Faltan parámetros en la configuración de WhatsApp.' };
    }

    const endpoint = `${config.urlBase.replace(/\/$/, '')}/chats/send?id=${config.sessionId}`;

    try {
      const sanitizedPhone = receiverPhone.replace(/\D/g, '');

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-access-token': config.token,
        },
        body: JSON.stringify({
          receiver: sanitizedPhone,
          isGroup: false,
          message: {
            text: text,
          },
        }),
      });

      const responseData = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(responseData?.message || 'Error en la respuesta de la API de WhatsApp');
      }

      return { success: true, data: responseData };
    } catch (error: any) {
      console.error('[WhatsAppService] Error enviando mensaje de texto:', error.message);
      throw new BadRequestException(`Error al enviar a WhatsApp: ${error.message}`);
    }
  }

  async testWhatsappConexion(usuarioId: string) {
    const usuario: any = await this.prisma.usuarios.findUnique({
      where: { IDusuarios: usuarioId },
    });

    if (!usuario) {
      throw new BadRequestException('El empleado seleccionado no existe.');
    }

    if (!usuario.telefono) {
      throw new BadRequestException('El empleado no tiene un número de teléfono configurado.');
    }

    const configGlobal = await this.getConfiguracionWhatsapp();
    if (!configGlobal.enabled) {
      throw new BadRequestException('El envío por WhatsApp no está habilitado globalmente.');
    }

    const mensaje = `¡Hola ${usuario.nombre}!\n\nEste es un mensaje de prueba para verificar que la integración con WhatsApp en el Punto de Venta funciona correctamente. ✅`;

    return this.sendTextToWhatsapp(usuario.telefono, mensaje);
  }

  async getEmpleadosParaPrueba() {
    const empleados = await this.prisma.usuarios.findMany({
      where: {
        telefono: { not: null },
        isActive: true,
      },
      select: {
        IDusuarios: true,
        nombre: true,
        telefono: true
      },
      orderBy: { nombre: 'asc' }
    });

    return empleados.map(e => ({
      id: e.IDusuarios,
      nombre: e.nombre,
      telefono: e.telefono
    }));
  }
}
