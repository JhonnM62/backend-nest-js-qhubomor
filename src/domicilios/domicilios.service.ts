import { Injectable, BadRequestException, UnauthorizedException, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AiService } from '../ai/ai.service';
import { ConfiguracionService } from '../configuracion/configuracion.service';
import { AppGateway } from '../websocket/app.gateway';

@Injectable()
export class DomiciliosService {
  private readonly logger = new Logger(DomiciliosService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly aiService: AiService,
    private readonly configService: ConfiguracionService,
    private readonly appGateway: AppGateway,
  ) {}

  async handleWebhook(payload: any, tokenHeader?: string) {
    // 1. Validar ping de prueba de conexión
    if (payload?.ping) {
      return { ok: true, status: 'pong', message: 'Webhook de Domicilios POS activo y listo' };
    }

    // 2. Obtener configuración del negocio
    const config = await this.configService.getConfiguracion();
    if (!config.domisHabilitado) {
      this.logger.warn('Webhook recibido pero el módulo de domicilios está deshabilitado.');
      return { ok: false, message: 'El módulo de domicilios WhatsApp está deshabilitado en este POS.' };
    }

    // 3. Validar token secreto si está configurado
    if (config.domisWebhookSecret && tokenHeader) {
      if (tokenHeader.trim() !== config.domisWebhookSecret.trim()) {
        this.logger.warn(`Token de webhook inválido: recibido "${tokenHeader}"`);
        throw new UnauthorizedException('Token de webhook inválido (x-webhook-token)');
      }
    }

    const parseMontoCOP = (val: any): number => {
      if (typeof val === 'number') {
        if (val > 0 && val < 100) return val * 1000;
        return val;
      }
      if (!val) return 0;
      const rawStr = String(val).trim();
      let str = rawStr.replace(/[^0-9.,]/g, '');
      if (!str) return 0;

      if (str.includes('.')) {
        const parts = str.split('.');
        if (parts.length > 2 || (parts.length === 2 && parts[1].length === 3)) {
          str = str.replace(/\./g, '');
        }
      }
      if (str.includes(',')) {
        const parts = str.split(',');
        if (parts.length > 2 || (parts.length === 2 && parts[1].length === 3)) {
          str = str.replace(/,/g, '');
        } else {
          str = str.replace(',', '.');
        }
      }

      let num = parseFloat(str) || 0;
      if (num > 0 && num < 100) {
        num = num * 1000;
      }
      return num;
    };

    const orderIdWA = String(payload.orderIdWA || payload.order_id || `ORDER_${Date.now()}`);
    const clienteTelefono = String(payload.clienteTelefono || payload.phone || payload.user_phone || '');
    const clienteNombre = payload.clienteNombre || payload.nombre_cliente || null;
    const direccion = payload.direccion || null;
    const detalleTextoWA = payload.detalleTextoWA || payload.detalle_completo || payload.pedido || payload.resumen || '';
    const metodoPagoWA = payload.metodoPagoWA || payload.metodo_pago || 'PENDIENTE';
    const totalWAStr = String(payload.totalWA || payload.total_a_cobrar || '0');
    let totalWANum = parseMontoCOP(payload.totalWA || payload.total_a_cobrar || '0');
    const timestampPedido = payload.timestamp ? new Date(Number(payload.timestamp)) : new Date();

    // 4. Mapeo inteligente con IA
    this.logger.log(`Procesando pedido ${orderIdWA} de WhatsApp con IA...`);
    let mapeoResult: any = { itemsPropios: [], itemsExternos: [], totalCalculado: 0 };
    try {
      mapeoResult = await this.aiService.mapearPedidoDomicilio(
        detalleTextoWA,
        totalWAStr,
        config.domisPromptMapeo || undefined,
      );
      if (mapeoResult.totalCalculado > 0 && totalWANum === 0) {
        totalWANum = mapeoResult.totalCalculado;
      }
    } catch (err: any) {
      this.logger.error(`Error en mapeo IA de domicilio: ${err.message}`);
    }

    // 5. Verificar si el pedido ya existe en BD (actualización vs creación)
    const existing = await this.prisma.domicilioWA.findUnique({
      where: { orderIdWA },
    });

    if (existing) {
      this.logger.log(`Actualizando domicilio existente ${orderIdWA}`);
      const updated = await this.prisma.domicilioWA.update({
        where: { orderIdWA },
        data: {
          clienteTelefono: clienteTelefono || existing.clienteTelefono,
          clienteNombre: clienteNombre || existing.clienteNombre,
          direccion: direccion || existing.direccion,
          detalleTextoWA,
          itemsMapeados: mapeoResult.itemsPropios,
          itemsExternos: mapeoResult.itemsExternos,
          totalWA: totalWANum,
          totalCalculado: mapeoResult.totalCalculado || totalWANum,
          metodoPagoWA,
        },
      });

      this.appGateway.emitDomicilioActualizado(updated);
      return { ok: true, action: 'updated', domicilio: updated };
    }

    // Crear nuevo pedido
    const nuevo = await this.prisma.domicilioWA.create({
      data: {
        orderIdWA,
        clienteTelefono,
        clienteNombre,
        direccion,
        detalleTextoWA,
        itemsMapeados: mapeoResult.itemsPropios,
        itemsExternos: mapeoResult.itemsExternos,
        totalWA: totalWANum,
        totalCalculado: mapeoResult.totalCalculado || totalWANum,
        metodoPagoWA,
        estado: 'RECIENTE',
        timestampPedido,
      },
    });

    this.logger.log(`Nuevo domicilio guardado exitosamente: ${nuevo.IDdomicilio} (${orderIdWA})`);
    this.appGateway.emitNuevoDomicilio(nuevo);
    return { ok: true, action: 'created', domicilio: nuevo };
  }

  async findAll(estado?: string) {
    const where: any = {};
    if (estado && estado !== 'TODOS') {
      where.estado = estado;
    }
    return this.prisma.domicilioWA.findMany({
      where,
      orderBy: { timestampPedido: 'desc' },
      include: {
        ventaRelacion: {
          select: { IDventas: true, estado: true, pedido: true, totalInput: true },
        },
      },
    });
  }

  async findOne(id: string) {
    const dom = await this.prisma.domicilioWA.findUnique({
      where: { IDdomicilio: id },
      include: { ventaRelacion: true },
    });
    if (!dom) throw new NotFoundException('Domicilio no encontrado');
    return dom;
  }

  async updateEstado(id: string, nuevoEstado: string, atendidoPor?: string) {
    const dom = await this.prisma.domicilioWA.findUnique({
      where: { IDdomicilio: id },
    });
    if (!dom) throw new NotFoundException('Domicilio no encontrado');

    const updated = await this.prisma.domicilioWA.update({
      where: { IDdomicilio: id },
      data: {
        estado: nuevoEstado,
        atendidoAt: nuevoEstado !== 'RECIENTE' ? new Date() : undefined,
        atendidoPor: atendidoPor || dom.atendidoPor,
      },
    });

    this.appGateway.emitDomicilioActualizado(updated);
    return updated;
  }

  async vincularVenta(id: string, ventaId: string) {
    const updated = await this.prisma.domicilioWA.update({
      where: { IDdomicilio: id },
      data: {
        ventaId,
        estado: 'COBRADO',
        atendidoAt: new Date(),
      },
    });
    this.appGateway.emitDomicilioActualizado(updated);
    return updated;
  }

  async remove(id: string) {
    const dom = await this.prisma.domicilioWA.findUnique({
      where: { IDdomicilio: id },
    });
    if (!dom) throw new NotFoundException('Domicilio no encontrado');

    await this.prisma.domicilioWA.delete({
      where: { IDdomicilio: id },
    });

    this.appGateway.emitDomicilioActualizado({ IDdomicilio: id, estado: 'ELIMINADO' } as any);
    return { ok: true, id };
  }
}
