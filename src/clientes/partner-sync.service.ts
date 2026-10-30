import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';

export interface SyncClientePayload {
  IDcliente: number;
  nombre?: string | null;
  cedula?: string | null;
  whatsapp?: string | null;
  direccion?: string | null;
  contador?: number;
  compras?: string;
  observaciones?: string | null;
  isActive?: boolean;
  origen?: string;
}

export interface SyncSellosPayload {
  clienteId: number;
  contador: number;
  comprasTotales?: number;
  accion?: string;
  origen?: string;
}

export interface SyncDomicilioTomadoPayload {
  orderIdWA: string;
  clienteId: number;
  clienteNombre?: string | null;
  estado?: string;
  atendidoPor?: string | null;
  origen?: string;
}

@Injectable()
export class PartnerSyncService {
  private readonly logger = new Logger(PartnerSyncService.name);
  private readonly defaultSecret = 'qhubo-secret-2026';

  /**
   * Obtiene la lista de URLs de los backends POS asociados (otros comercios/restaurantes).
   */
  getPartnerUrls(): string[] {
    const rawEnv = process.env.PARTNER_POS_URLS || process.env.FIDELIDAD_EXTERNA_URL || '';
    const envUrls = rawEnv
      .split(',')
      .map((u) => u.trim())
      .filter(Boolean);

    // Detección automática según el entorno / nombre / puerto
    const autoUrls: string[] = [];
    const port = String(process.env.PORT || '3000');
    const appName = (process.env.APP_NAME || '').toLowerCase();

    // Si este backend es restaurante2 o fogata (puerto 8071 / 8073 o nombre restaurante), su partner es Q'hubo Mor (Granizados)
    const isRestaurante =
      appName.includes('restaurante') ||
      appName.includes('fogata') ||
      port === '8071' ||
      port === '8073';

    if (isRestaurante) {
      autoUrls.push('https://backendnestpv.autosystemprojects.site/api/v1');
    } else {
      // Si este backend es Q'hubo Mor (Granizados), sus partners son restaurante2 y fogata
      autoUrls.push('https://api-restaurante2.autosystemprojects.site/api/v1');
      autoUrls.push('https://api-fogata.autosystemprojects.site/api/v1');
    }

    const all = Array.from(new Set([...envUrls, ...autoUrls]));
    // Excluir self si se conoce el dominio propio
    const myDomain = (process.env.MY_DOMAIN || process.env.PUBLIC_API_URL || '').toLowerCase();
    return all.filter((u) => !myDomain || !u.toLowerCase().includes(myDomain));
  }

  /**
   * Genera un ID de cliente de 6 dígitos determinista para un teléfono o cédula.
   * Si dos aplicaciones reciben el mismo pedido al mismo tiempo sin conocer al cliente,
   * ambas calculan exactamente el mismo ID numérico.
   */
  generarIdDeterminista(cleanPhone?: string | null, cleanCedula?: string | null): number {
    const seed = (cleanCedula || cleanPhone || '').replace(/\D/g, '');
    if (!seed || seed.length < 4) {
      return Math.floor(100000 + Math.random() * 900000);
    }
    let hash = 0;
    for (let i = 0; i < seed.length; i++) {
      hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
    }
    return 100000 + (hash % 900000);
  }

  /**
   * Consulta a las apps partner si alguna ya tiene registrado a este cliente.
   * Retorna los datos del cliente si existe en algún partner.
   */
  async buscarClienteEnPartners(cleanPhone?: string | null, cleanCedula?: string | null): Promise<any | null> {
    const urls = this.getPartnerUrls();
    const ident = cleanCedula || cleanPhone;
    if (!ident || !urls.length) return null;

    for (const baseUrl of urls) {
      try {
        const cleanBase = baseUrl.replace(/\/+$/, '');
        const endpoint = `${cleanBase}/clientes/fidelidad/${encodeURIComponent(ident)}`;
        const res = await axios.get(endpoint, {
          timeout: 4000,
          headers: {
            'x-sync-token': this.defaultSecret,
            'x-sync-origin': process.env.APP_NAME || 'partner_pos',
          },
        });
        if (res.data && res.data.IDcliente) {
          this.logger.log(`Cliente encontrado en partner ${baseUrl}: #${res.data.IDcliente} (${res.data.nombre})`);
          return res.data;
        }
      } catch (err: any) {
        // 404 significa que no existe en ese partner específico
        if (err?.response?.status !== 404) {
          this.logger.debug(`Búsqueda en partner ${baseUrl} devolvió: ${err.message}`);
        }
      }
    }
    return null;
  }

  /**
   * Sincroniza la creación o unificación de un cliente hacia todas las apps partner.
   */
  async syncUpsertCliente(cliente: any): Promise<void> {
    const urls = this.getPartnerUrls();
    if (!urls.length || !cliente || !cliente.IDcliente) return;

    const payload: SyncClientePayload = {
      IDcliente: Number(cliente.IDcliente),
      nombre: cliente.nombre,
      cedula: cliente.cedula ? cliente.cedula.toString() : null,
      whatsapp: cliente.whatsapp || null,
      direccion: cliente.direccion || null,
      contador: Number(cliente.contador || 0),
      compras: String(cliente.compras || '0'),
      observaciones: cliente.observaciones || null,
      isActive: cliente.isActive ?? true,
      origen: process.env.APP_NAME || 'pos_origin',
    };

    for (const baseUrl of urls) {
      try {
        const endpoint = `${baseUrl.replace(/\/+$/, '')}/clientes/sync/upsert`;
        await axios.post(endpoint, payload, {
          timeout: 4000,
          headers: {
            'x-sync-token': this.defaultSecret,
            'x-sync-origin': process.env.APP_NAME || 'partner_pos',
          },
        });
        this.logger.log(`Cliente #${cliente.IDcliente} sincronizado con partner ${baseUrl}`);
      } catch (err: any) {
        this.logger.warn(`No se pudo sincronizar cliente #${cliente.IDcliente} con ${baseUrl}: ${err.message}`);
      }
    }
  }

  /**
   * Sincroniza la actualización de campos de un cliente a los partners.
   */
  async syncUpdateCliente(id: number, data: any): Promise<void> {
    const urls = this.getPartnerUrls();
    if (!urls.length || !id) return;

    for (const baseUrl of urls) {
      try {
        const endpoint = `${baseUrl.replace(/\/+$/, '')}/clientes/sync/${id}`;
        await axios.patch(endpoint, data, {
          timeout: 4000,
          headers: {
            'x-sync-token': this.defaultSecret,
            'x-sync-origin': process.env.APP_NAME || 'partner_pos',
          },
        });
        this.logger.log(`Update de cliente #${id} enviado a partner ${baseUrl}`);
      } catch (err: any) {
        this.logger.warn(`No se pudo enviar update de cliente #${id} a ${baseUrl}: ${err.message}`);
      }
    }
  }

  /**
   * Sincroniza los sellos / contador de fidelidad bidireccionalmente.
   */
  async syncSellos(clienteId: number, data: { contador: number; comprasTotales?: number; accion?: string; origen?: string }): Promise<void> {
    const urls = this.getPartnerUrls();
    if (!urls.length || !clienteId) return;

    const payload: SyncSellosPayload = {
      clienteId: Number(clienteId),
      contador: Number(data.contador || 0),
      comprasTotales: Number(data.comprasTotales || 0),
      accion: data.accion || 'RECALCULO',
      origen: data.origen || process.env.APP_NAME || 'pos_origin',
    };

    for (const baseUrl of urls) {
      try {
        const endpoint = `${baseUrl.replace(/\/+$/, '')}/clientes/sync/sellos`;
        await axios.post(endpoint, payload, {
          timeout: 4000,
          headers: {
            'x-sync-token': this.defaultSecret,
            'x-sync-origin': process.env.APP_NAME || 'partner_pos',
          },
        });
        this.logger.log(`Sellos de cliente #${clienteId} (${payload.contador}/10) sincronizados con ${baseUrl}`);
      } catch (err: any) {
        this.logger.warn(`Error sincronizando sellos de #${clienteId} con ${baseUrl}: ${err.message}`);
      }
    }
  }

  /**
   * Notifica a la otra app que un domicilio fue tomado o vinculado a un cliente.
   * Así ambas apps muestran exactamente la misma tarjeta de cliente y el mismo estado.
   */
  async syncDomicilioTomado(orderIdWA: string, data: { clienteId: number; clienteNombre?: string | null; estado?: string; atendidoPor?: string | null }): Promise<void> {
    const urls = this.getPartnerUrls();
    if (!urls.length || !orderIdWA) return;

    const payload: SyncDomicilioTomadoPayload = {
      orderIdWA,
      clienteId: Number(data.clienteId),
      clienteNombre: data.clienteNombre || null,
      estado: data.estado || 'TOMADO',
      atendidoPor: data.atendidoPor || 'Partner POS',
      origen: process.env.APP_NAME || 'pos_origin',
    };

    for (const baseUrl of urls) {
      try {
        const endpoint = `${baseUrl.replace(/\/+$/, '')}/domicilios/sync-tomado`;
        await axios.post(endpoint, payload, {
          timeout: 4000,
          headers: {
            'x-sync-token': this.defaultSecret,
            'x-sync-origin': process.env.APP_NAME || 'partner_pos',
          },
        });
        this.logger.log(`Domicilio #${orderIdWA} mapeado con cliente #${data.clienteId} comunicado a ${baseUrl}`);
      } catch (err: any) {
        this.logger.warn(`No se pudo comunicar domicilio tomado #${orderIdWA} a ${baseUrl}: ${err.message}`);
      }
    }
  }

  /**
   * Sincroniza eliminación/desactivación de cliente.
   */
  async syncRemoveCliente(id: number): Promise<void> {
    const urls = this.getPartnerUrls();
    if (!urls.length || !id) return;

    for (const baseUrl of urls) {
      try {
        const endpoint = `${baseUrl.replace(/\/+$/, '')}/clientes/sync/${id}`;
        await axios.delete(endpoint, {
          timeout: 4000,
          headers: {
            'x-sync-token': this.defaultSecret,
            'x-sync-origin': process.env.APP_NAME || 'partner_pos',
          },
        });
      } catch (err: any) {
        this.logger.warn(`Error comunicando eliminación de #${id} a ${baseUrl}: ${err.message}`);
      }
    }
  }
}
