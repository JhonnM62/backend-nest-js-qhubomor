import { Injectable, BadRequestException, UnauthorizedException, Logger, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { AiService } from '../ai/ai.service';
import { ConfiguracionService } from '../configuracion/configuracion.service';
import { AppGateway } from '../websocket/app.gateway';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class DomiciliosService {
  private readonly logger = new Logger(DomiciliosService.name);
  private alertedTimeoutIds = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly aiService: AiService,
    private readonly configService: ConfiguracionService,
    private readonly appGateway: AppGateway,
    private readonly notificationsService: NotificationsService,
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
        config.domisReglasEmpaque || undefined,
      );
      if (mapeoResult.totalCalculado > 0 && totalWANum === 0) {
        totalWANum = mapeoResult.totalCalculado;
      }
    } catch (err: any) {
      this.logger.error(`Error en mapeo IA de domicilio: ${err.message}`);
    }

    // 4.1 Resolver o auto-crear cliente para fidelidad
    let matchedClienteId: number | null = payload.clienteId ? Number(payload.clienteId) : null;
    const cleanCedula = payload.clienteCedula ? String(payload.clienteCedula).replace(/\D/g, '') : '';
    const cleanPhone = clienteTelefono ? clienteTelefono.replace(/\D/g, '') : '';

    if (!matchedClienteId && (cleanCedula || cleanPhone)) {
      try {
        const orCond: Prisma.ClientesWhereInput[] = [];
        if (cleanCedula && !isNaN(Number(cleanCedula))) {
          orCond.push({ cedula: BigInt(cleanCedula) });
        }
        if (cleanPhone) {
          orCond.push({ whatsapp: { contains: cleanPhone } });
        }
        const existingCli = await this.prisma.clientes.findFirst({
          where: { isActive: true, OR: orCond },
        });

        if (existingCli) {
          matchedClienteId = existingCli.IDcliente;
        } else if (clienteNombre || cleanCedula || cleanPhone) {
          let newId = Math.floor(10000 + Math.random() * 900000);
          let unique = false;
          while (!unique) {
            const ex = await this.prisma.clientes.findUnique({ where: { IDcliente: newId } });
            if (!ex) unique = true;
            else newId = Math.floor(10000 + Math.random() * 900000);
          }
          const created = await this.prisma.clientes.create({
            data: {
              IDcliente: newId,
              nombre: clienteNombre || (cleanCedula ? `Cliente CC ${cleanCedula}` : 'Cliente WhatsApp'),
              cedula: cleanCedula && !isNaN(Number(cleanCedula)) ? BigInt(cleanCedula) : null,
              whatsapp: cleanPhone || null,
              direccion: direccion || null,
              contador: 0,
              compras: '0',
              observaciones: 'Registrado automáticamente desde domicilio WhatsApp.',
              isActive: true,
            },
          });
          matchedClienteId = created.IDcliente;
        }
      } catch (e: any) {
        this.logger.warn(`No se pudo resolver cliente para domicilio: ${e.message}`);
      }
    }

    const origenConCliente = matchedClienteId ? `whatsapp_bot:cliente:${matchedClienteId}` : 'whatsapp_bot';

    // 4.1 Si el local es de Comida/Restaurante y el pedido NO CONTIENE comida (es solo granizados/bebidas)
    if (mapeoResult?.isComidaBusiness && !mapeoResult?.tieneComida) {
      this.logger.warn(
        `[DOMICILIOS] Pedido ${orderIdWA} es EXCLUSIVO de granizados/bebidas (sin comida) y este local es Restaurante de comida. IGNORANDO pedido en este local.`
      );
      return {
        ok: true,
        action: 'ignored',
        message: 'Pedido exclusivo de granizados/bebidas ignorado en local de comida',
      };
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
        origen: origenConCliente,
        timestampPedido,
      },
    });

    this.logger.log(`Nuevo domicilio guardado exitosamente: ${nuevo.IDdomicilio} (${orderIdWA})`);
    this.appGateway.emitNuevoDomicilio(nuevo);

    // Enviar notificación push al móvil a todos los usuarios activos (incluyendo no admins)
    try {
      const clienteDesc = nuevo.clienteNombre || nuevo.clienteTelefono || 'Cliente';
      const totalStr = nuevo.totalWA ? `$${Number(nuevo.totalWA).toLocaleString('es-CO')}` : '';
      const dirStr = nuevo.direccion ? ` (${nuevo.direccion})` : '';
      this.notificationsService.sendDomicilioNotification(
        'NUEVO_DOMICILIO',
        `🛵 Nuevo Domicilio #${nuevo.orderIdWA}`,
        `${clienteDesc}${dirStr} por ${totalStr}. ¡Por favor atiéndelo!`,
        {
          domicilioId: nuevo.IDdomicilio,
          orderIdWA: nuevo.orderIdWA,
          totalWA: nuevo.totalWA,
          clienteNombre: nuevo.clienteNombre,
          clienteTelefono: nuevo.clienteTelefono,
          direccion: nuevo.direccion,
        }
      ).catch(err => this.logger.error(`Error enviando push nuevo domicilio: ${err.message}`));
    } catch (err: any) {
      this.logger.error(`Error preparando push nuevo domicilio: ${err.message}`);
    }

    return { ok: true, action: 'created', domicilio: nuevo };
  }

  /**
   * Cronjob ejecutado cada minuto para verificar si existen domicilios en estado 'RECIENTE'
   * que hayan superado el tiempo límite de configuración (domisTimeoutMinutos) sin ser atendidos.
   * Envía push notification y emite evento socket.
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async checkDomiciliosSinAtender() {
    try {
      const config = await this.configService.getConfiguracion();
      if (!config.domisHabilitado) return;

      const timeoutMinutos = config.domisTimeoutMinutos && config.domisTimeoutMinutos > 0 ? config.domisTimeoutMinutos : 10;
      const ahora = Date.now();
      const cutoffTime = new Date(ahora - timeoutMinutos * 60 * 1000);
      const limite24Horas = new Date(ahora - 24 * 60 * 60 * 1000);

      const desatendidos = await this.prisma.domicilioWA.findMany({
        where: {
          estado: 'RECIENTE',
          timestampPedido: {
            lte: cutoffTime,
            gte: limite24Horas,
          },
        },
      });

      const isComida = await this.isBusinessComida();

      for (const dom of desatendidos) {
        // En locales de comida rápida, no alertar por pedidos que sean solo granizados
        if (
          isComida &&
          !this.aiService.pedidoTieneComida(
            dom.detalleTextoWA,
            dom.itemsMapeados as any[],
            dom.itemsExternos as any[],
          )
        ) {
          continue;
        }

        if (this.alertedTimeoutIds.has(dom.IDdomicilio)) {
          continue;
        }

        this.alertedTimeoutIds.add(dom.IDdomicilio);
        const minutos = Math.max(
          timeoutMinutos,
          Math.round((ahora - new Date(dom.timestampPedido).getTime()) / 60000)
        );
        const clienteDesc = dom.clienteNombre || dom.clienteTelefono || 'Cliente';

        this.logger.warn(`Domicilio sin atender #${dom.orderIdWA} superó límite de ${minutos} min`);

        // Emitir evento Socket para alertas en pantallas web y POS
        this.appGateway.emitDomicilioTimeout(dom);

        // Enviar notificación push urgente al móvil a todos los usuarios
        await this.notificationsService.sendDomicilioNotification(
          'DOMICILIO_TIMEOUT',
          `⏰ ¡Domicilio sin atender! #${dom.orderIdWA}`,
          `El pedido de ${clienteDesc} lleva ${minutos} min sin atenderse. ¡Por favor atiéndelo!`,
          {
            domicilioId: dom.IDdomicilio,
            orderIdWA: dom.orderIdWA,
            totalWA: dom.totalWA,
            clienteNombre: dom.clienteNombre,
            minutos,
          }
        ).catch(err => this.logger.error(`Error enviando push timeout: ${err.message}`));
      }
    } catch (err: any) {
      this.logger.error(`Error en checkDomiciliosSinAtender: ${err.message}`);
    }
  }

  private async isBusinessComida(): Promise<boolean> {
    try {
      const cats: Array<{ nombre: string }> = await this.prisma.categorias.findMany({ select: { nombre: true } }).catch(() => []);
      return cats.some((c) =>
        /hamburguesa|alitas|salchipapa|carne|perro|sandwich|sanduche|fundido|queso|parrilla|asado|costilla|platos|cocina/i.test(c.nombre || ''),
      );
    } catch {
      return false;
    }
  }

  async findAll(estado?: string) {
    const where: any = {};
    if (estado && estado !== 'TODOS') {
      where.estado = estado;
    }
    const list = await this.prisma.domicilioWA.findMany({
      where,
      orderBy: { timestampPedido: 'desc' },
      include: {
        ventaRelacion: {
          select: {
            IDventas: true,
            estado: true,
            pedido: true,
            totalInput: true,
            comandaImpresaAt: true,
            cocinaInicioAt: true,
            cocinaFinAt: true,
          },
        },
      },
    });

    const isComida = await this.isBusinessComida();
    if (isComida) {
      return list.filter((dom) =>
        this.aiService.pedidoTieneComida(
          dom.detalleTextoWA,
          dom.itemsMapeados as any[],
          dom.itemsExternos as any[],
        ),
      );
    }

    return list;
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

    if (nuevoEstado !== 'RECIENTE') {
      this.alertedTimeoutIds.delete(id);
    }

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

  async vincularVenta(id: string, ventaId: string, nuevoEstado?: string) {
    this.alertedTimeoutIds.delete(id);
    const now = new Date();
    const estadoFinal = nuevoEstado || 'TOMADO';

    const updated = await this.prisma.domicilioWA.update({
      where: { IDdomicilio: id },
      data: {
        ventaId,
        estado: estadoFinal,
        atendidoAt: now,
      },
    });

    if (ventaId && (estadoFinal === 'TOMADO' || estadoFinal === 'COBRADO' || estadoFinal === 'PAGADO')) {
      try {
        const ventaExistente = await this.prisma.ventas.findUnique({
          where: { IDventas: ventaId },
          select: { comandaImpresaAt: true, cocinaInicioAt: true },
        });
        if (ventaExistente) {
          const updateVentaData: any = {
            comandaImpresaAt: ventaExistente.comandaImpresaAt || now,
            cocinaInicioAt: ventaExistente.cocinaInicioAt || now,
          };

          if (!(ventaExistente as any).clienteId) {
            let cidToLink: number | null = null;
            if (updated.origen && updated.origen.includes('cliente:')) {
              const parts = updated.origen.split('cliente:');
              cidToLink = parseInt(parts[1], 10) || null;
            }
            if (!cidToLink && updated.clienteTelefono) {
              const cleanP = updated.clienteTelefono.replace(/\D/g, '');
              if (cleanP) {
                const cli = await this.prisma.clientes.findFirst({
                  where: { isActive: true, whatsapp: { contains: cleanP } },
                  select: { IDcliente: true },
                });
                if (cli) cidToLink = cli.IDcliente;
              }
            }
            if (cidToLink) {
              updateVentaData.clienteId = cidToLink;
            }
          }

          await this.prisma.ventas.update({
            where: { IDventas: ventaId },
            data: updateVentaData,
          });
          await this.prisma.orderventas.updateMany({
            where: { IDventas: ventaId },
            data: { comandaImpresa: true },
          });
        }
      } catch (err: any) {
        this.logger.warn(`No se pudo marcar comandaImpresa en venta vinculada ${ventaId}: ${err.message}`);
      }
    }

    this.appGateway.emitDomicilioActualizado(updated);
    return updated;
  }

  async remove(id: string) {
    this.alertedTimeoutIds.delete(id);

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
