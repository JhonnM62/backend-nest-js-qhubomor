import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import axios from 'axios';
import { PrismaService } from '../prisma/prisma.service';
import { CreateVentaDto, CreateOrderVentaDto, CreateVentaCompletaDto, VentaQueryDto } from './dto/venta.dto';
import { Prisma } from '@prisma/client';
import { NotificationsService } from '../notifications/notifications.service';
import { InsumosService } from '../insumos/insumos.service';
import { AppGateway } from '../websocket/app.gateway';
import { SocketEvent } from '../websocket/types/socket.types';
import { FacturacionService } from '../facturacion/facturacion.service';

@Injectable()
export class VentasService {
  private readonly logger = new Logger(VentasService.name);
  private cachedConfigNegocio: { data: any; timestamp: number } | null = null;

  constructor(
    private prisma: PrismaService,
    private notificationsService: NotificationsService,
    private insumosService: InsumosService,
    private appGateway: AppGateway,
    private facturacionService: FacturacionService,
  ) {}

  async getConfiguracionNegocioCached() {
    const now = Date.now();
    if (this.cachedConfigNegocio && now - this.cachedConfigNegocio.timestamp < 60000) {
      return this.cachedConfigNegocio.data;
    }
    let config = await this.prisma.configuracionNegocio.findUnique({ where: { id: 1 } });
    if (!config) {
      config = {
        id: 1,
        nombreComercial: 'Q HUBO MOR',
        nit: null,
        direccion: null,
        telefono: null,
        horaCorteDia: '00:00',
        modoOperacion: 'GENERAL',
        latitudNegocio: null,
        longitudNegocio: null,
        radioGeocercaM: 100,
        minutosGraciaLlegadaTarde: 5,
        updatedAt: new Date(),
        emitirFacturaAutomatica: false,
        opcionesPropina: [5, 10, 15],
        opcionesDescuento: [5, 10, 20],
        habilitarPropinas: true,
        habilitarDescuentos: true,
        tiempoReservaInventario: 5,
        porcentajeMermaPapa: 10,
      } as any;
    }
    this.cachedConfigNegocio = { data: config, timestamp: now };
    return config;
  }

  private recentSalesByTemporalId = new Map<string, { venta: any; timestamp: number }>();
  private inFlightSalesByTemporalId = new Map<string, Promise<any>>();

  private formatDuration(diffMs: number): string {
    const totalSeconds = Math.max(0, Math.floor(diffMs / 1000));
    const d = Math.floor(totalSeconds / 86400);
    const h = Math.floor((totalSeconds % 86400) / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    return `${d.toString().padStart(2, '0')}:${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }

  private generateTiempoLog(estadoFinal: string = 'iniciado', cartStartTime?: string | null) {
    const now = new Date();
    
    // Si tenemos un cartStartTime, significa que el usuario inició el carrito antes de enviarlo
    if (cartStartTime && estadoFinal && estadoFinal !== 'iniciado' && estadoFinal !== 'EN_EL_CARRITO') {
      const inicioTime = new Date(Math.min(new Date(cartStartTime).getTime(), now.getTime()));
      const diffMs = now.getTime() - inicioTime.getTime();
      const duracionFinal = diffMs > 0 ? this.formatDuration(diffMs) : '00:00:00:00';

      return [
        {
          fecha_hora: inicioTime.toISOString(),
          estado: 'iniciado',
          duracion: '00:00:00:00',
        },
        {
          fecha_hora: now.toISOString(),
          estado: estadoFinal,
          duracion: duracionFinal,
        }
      ];
    }

    return [
      {
        fecha_hora: now.toISOString(),
        estado: estadoFinal || 'iniciado',
        duracion: '00:00:00:00',
      }
    ];
  }

  private appendTiempoLog(existingLog: any, nuevoEstado: string) {
    let log = Array.isArray(existingLog) ? existingLog : [];
    
    // Prevent consecutive duplicate states
    if (log.length > 0 && log[log.length - 1].estado === nuevoEstado) {
      return log;
    }

    const now = new Date();
    let duracion = '00:00:00:00';

    if (log.length > 0) {
      const lastEntryTime = new Date(log[log.length - 1].fecha_hora);
      const diffMs = now.getTime() - lastEntryTime.getTime();
      duracion = this.formatDuration(diffMs);
    }

    return [
      ...log,
      {
        fecha_hora: now.toISOString(),
        estado: nuevoEstado,
        duracion,
      },
    ];
  }

  private async applyRecipeDeductions(
    productos: CreateOrderVentaDto[] | Prisma.OrderventasGetPayload<{}>[],
    tipo: 'entrada' | 'salida',
    motivoPrefijo: string
  ) {
    if (!productos || productos.length === 0) return;

    for (const producto of productos) {
      const productoId = producto.productoId || (producto as any).IDproductos;
      const cantidadVendida = Number(producto.cantidad) || 0;
      const nombreProd = producto.nombre || producto.nombreProducto || 'Producto';

      if (!productoId || cantidadVendida <= 0) {
        console.log(`[RECETA-SKIP] Producto "${nombreProd}" sin productoId o cantidad<=0 (productoId=${productoId}, cantidad=${cantidadVendida})`);
        continue;
      }

      // Buscar la receta de este producto
      const recetas = await this.prisma.recetainsumos.findMany({
        where: { IDproductos: productoId },
        include: { insumoRelacion: true },
      });

      if (recetas.length === 0) {
        console.log(`[RECETA-INFO] Producto "${nombreProd}" (${productoId}) no tiene receta de insumos.`);
        continue;
      }

      console.log(`[RECETA-${tipo.toUpperCase()}] Producto: "${nombreProd}" x${cantidadVendida} → ${recetas.length} insumo(s) en receta`);

      for (const receta of recetas) {
        const insumo = receta.insumoRelacion;
        const descontarVal = insumo?.descontarCantDeVentas?.trim().toLowerCase();
        // Descontamos siempre a menos que explícitamente diga 'no'
        const descontarFlag = descontarVal !== 'no' && descontarVal !== 'falso' && descontarVal !== 'false';

        // Si receta.cantidad es nula, asumimos 1 por defecto; si es Decimal, lo convertimos
        const recetaCantidad = receta.cantidad ? Number(receta.cantidad) : 1;

        if (insumo && descontarFlag) {
          const cantidadTotal = cantidadVendida * recetaCantidad;
          if (cantidadTotal > 0) {
            try {
              console.log(`[RECETA-${tipo.toUpperCase()}]   └─ Insumo: "${insumo.nombre}" (${insumo.IDalimentos}) | receta=${recetaCantidad} x vendido=${cantidadVendida} = ${cantidadTotal} a ${tipo === 'salida' ? 'descontar' : 'devolver'}`);
              await this.insumosService.movimientoStock(
                insumo.IDalimentos,
                tipo,
                cantidadTotal,
                `${motivoPrefijo}: ${nombreProd} (x${cantidadVendida})`,
                undefined,
                true // allowNegative
              );
            } catch (error) {
              console.error(`[RECETA-ERROR] Error aplicando ${tipo} de receta para insumo "${insumo.nombre}" (${insumo.IDalimentos}):`, error);
            }
          }
        } else if (insumo && !descontarFlag) {
          console.log(`[RECETA-SKIP]   └─ Insumo: "${insumo.nombre}" tiene descontarCantDeVentas="${insumo.descontarCantDeVentas}", omitido.`);
        }
      }
    }
  }

  private async getFechaContable(date: Date = new Date(), manualDate?: string): Promise<Date> {
    if (manualDate) {
      // Si el frontend envía una fecha manual ("Ventas Olvidadas"), la respetamos
      const parts = manualDate.split('-');
      if (parts.length === 3) {
        return new Date(Date.UTC(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2])));
      }
    }

    // Buscar configuración dinámica cacheada (TTL 60s)
    const config = await this.getConfiguracionNegocioCached();
    
    const [corteHours, corteMinutes] = config!.horaCorteDia.split(':').map(Number);

    // FIX: Los servidores Docker están en UTC. 
    // Forzamos el cálculo basado en la zona horaria local (UTC-5 Colombia)
    const localDate = new Date(date.getTime() - (5 * 60 * 60 * 1000));

    // Si la hora local es antes de la hora de corte, pertenece al día contable anterior
    const currentMinutes = (localDate.getUTCHours() * 60) + localDate.getUTCMinutes();
    const corteTotalMinutes = (corteHours * 60) + corteMinutes;

    if (currentMinutes < corteTotalMinutes) {
      localDate.setUTCDate(localDate.getUTCDate() - 1);
    }

    // Normalizamos a medianoche para que funcione como una "fecha pura" sin horas
    localDate.setUTCHours(0, 0, 0, 0);
    // Para guardarlo en la BD de Prisma sin desfases, devolvemos la fecha UTC normalizada
    return localDate;
  }

  private async resolveMesaOrCreate(mesaInput: string | null | undefined): Promise<string | null> {
    if (!mesaInput || mesaInput === 'V.R' || mesaInput === 'CAJA') {
      return null;
    }
    
    // Buscar por ID
    try {
      const mesaById = await this.prisma.mesas.findUnique({
        where: { IdMesas: mesaInput },
      });
      if (mesaById) {
        return mesaById.IdMesas;
      }
    } catch (e) {
      // Not a valid UUID
    }

    // Buscar por Nombre
    const mesaByName = await this.prisma.mesas.findFirst({
      where: { nombre: mesaInput },
    });
    if (mesaByName) {
      return mesaByName.IdMesas;
    }

    // Crear la mesa temporal si no existe
    const nuevaMesa = await this.prisma.mesas.create({
      data: { nombre: mesaInput },
    });
    return nuevaMesa.IdMesas;
  }

  async create(createVentaDto: CreateVentaDto & { fechaContableManual?: string }) {
    console.log('[DEBUG create] createVentaDto.mesa:', createVentaDto.mesa);
    console.log('[DEBUG create] createVentaDto.clienteId:', createVentaDto.clienteId);
    console.log('[DEBUG create] Full DTO:', JSON.stringify(createVentaDto));
    
    const now = new Date();
    const fechaContable = await this.getFechaContable(now, createVentaDto.fechaContableManual);
    const pedido = await this.generatePedidoNumber(createVentaDto.mesa, undefined, fechaContable);

    if (createVentaDto.temporalId) {
      this.appGateway.emitToVentas(SocketEvent.VENTA_ID_GENERATED, { temporalId: createVentaDto.temporalId, pedido });
    }

    const validMesaId = await this.resolveMesaOrCreate(createVentaDto.mesa);

    const ventaData: any = {
      ...createVentaDto,
      fechaContableManual: undefined,
      mesa: validMesaId,
      pedido,
      fechaYHora: now,
      fecha: fechaContable,
      hora: now.toLocaleTimeString('en-US', { timeZone: 'America/Bogota', hour12: false }),
      estado: createVentaDto.estado || 'iniciado',
      registroDeTiempo: this.generateTiempoLog(createVentaDto.estado || 'iniciado', createVentaDto.cartStartTime),
    };

    console.log('[DEBUG create] ventaData.mesa:', ventaData.mesa);
    console.log('[DEBUG create] ventaData.clienteId:', ventaData.clienteId);

    const venta = await this.prisma.ventas.create({
      data: ventaData,
    });

    if (ventaData.clienteId) {
      await this.recalcularFidelidadCliente(ventaData.clienteId);
    }

    this.appGateway.emitToVentas(SocketEvent.REFRESH_VENTAS, { action: 'create', venta });

    return venta;
  }

  async generatePedidoNumber(mesaId: string | null | undefined, usuarioNombre: string | null | undefined, providedFechaContable?: Date): Promise<string> {
    const fechaContable = providedFechaContable || await this.getFechaContable(new Date());

    let maxConsecutivo = 0;
    try {
      // Optimización: Cálculo atómico de 1 ms directo en PostgreSQL
      const rawResult = await this.prisma.$queryRaw<Array<{ max_num: number | null }>>`
        SELECT MAX(CAST(SUBSTRING("Pedido" FROM '-([0-9]+)$') AS INTEGER)) AS max_num
        FROM "VENTAS"
        WHERE "FECHA" = ${fechaContable}
          AND "deletedAt" IS NULL
          AND "Pedido" ~ '-[0-9]+$'
      `;
      if (rawResult && rawResult[0]?.max_num != null) {
        maxConsecutivo = Number(rawResult[0].max_num) || 0;
      }
    } catch (sqlErr: any) {
      this.logger.warn(`Fallback en generatePedidoNumber por error SQL (${sqlErr?.message})`);
      const ventasDelTurno = await this.prisma.ventas.findMany({
        where: {
          fecha: fechaContable,
          deletedAt: null,
        },
        select: {
          pedido: true,
        },
      });

      for (const venta of ventasDelTurno) {
        if (venta.pedido) {
          const match = venta.pedido.match(/-(\d+)$/);
          if (match) {
            const num = parseInt(match[1], 10);
            if (num > maxConsecutivo) {
              maxConsecutivo = num;
            }
          }
        }
      }
    }

    const siguienteNumero = maxConsecutivo + 1;
    const numeroConsecutivo = siguienteNumero.toString().padStart(3, '0');

    let mesaStr = 'V.R';
    if (mesaId && mesaId !== 'V.R' && mesaId !== 'CAJA') {
      mesaStr = mesaId; // Asumimos que puede ser texto libre
      try {
        const mesaObj = await this.prisma.mesas.findUnique({
          where: { IdMesas: mesaId },
          select: { nombre: true },
        });
        if (mesaObj && mesaObj.nombre) {
          mesaStr = mesaObj.nombre;
        }
      } catch (error) {
        // mesa not found (might be a custom string or invalid UUID), keep mesaStr as mesaId
      }
    }

    const inicial = usuarioNombre ? usuarioNombre.charAt(0).toUpperCase() : 'X';

    return `${mesaStr}-${inicial}-${numeroConsecutivo}`;
  }

  async recalcularFidelidadCliente(clienteId: number): Promise<number> {
    if (!clienteId || isNaN(clienteId)) return 0;

    const cliente = await this.prisma.clientes.findUnique({
      where: { IDcliente: clienteId },
    });

    if (!cliente) return 0;

    // 1. Sellos de Misiones (Google Maps, Redes Sociales) guardados en observaciones
    let sellosMisiones = 0;
    const obs = cliente.observaciones || '';
    if (obs.includes('[MISION_GOOGLE_REVIEW_OK]')) sellosMisiones += 1;
    if (obs.includes('[MISION_REDES_SOCIALES_OK]')) sellosMisiones += 1;

    // 2. Ventas activas y válidas del cliente (no eliminadas ni canceladas)
    const ventasOrConditions: Prisma.VentasWhereInput[] = [
      { clienteId: clienteId },
      { cliente: String(clienteId) },
    ];
    if (cliente.cedula) {
      ventasOrConditions.push({ cliente: cliente.cedula.toString() });
    }

    const ventasActivas = await this.prisma.ventas.findMany({
      where: {
        OR: ventasOrConditions,
        deletedAt: null,
        deleteReason: null,
        estado: {
          notIn: ['CANCELADO', 'ANULADO', 'ELIMINADO'],
        },
      },
      include: {
        ordenVentas: true,
      },
      orderBy: {
        fechaYHora: 'asc',
      },
    });

    // 1.1 Compras externas de comida sincronizadas: [COMPRA_EXTERNA:ventaId:platos]
    const comprasExternas: number[] = [];
    const matchExternas = Array.from(obs.matchAll(/\[COMPRA_EXTERNA:[^:]+:(\d+)\]/g));
    for (const m of matchExternas) {
      const cant = parseInt(m[1], 10) || 0;
      if (cant > 0) {
        comprasExternas.push(cant);
      }
    }

    // Helper para identificar si un ítem es empaque o desechable
    const esDesechableOEmpaque = (nombre?: string | null, categoria?: string | null) => {
      const text = `${nombre || ''} ${categoria || ''}`.toLowerCase();
      return /tapa|caja|vaso|empaque|desechable|bolsa|envase|cubierto/i.test(text);
    };

    // 3. Extraer eventos de compra válidos (solo productos facturados > $0, excluyendo empaques)
    const eventosCompras: number[] = [];

    for (const v of ventasActivas) {
      const itemsValidos = (v.ordenVentas || []).filter((item) => {
        const precio = Number(item.precio || item.precioTotal || 0);
        // Regla 1: Precios $0 NO suman sellos (ej. granizados promo 2x2 por comida)
        if (precio <= 0) return false;

        // Regla 2: Desechables y empaques NO suman sellos
        if (esDesechableOEmpaque(item.nombre, item.categoria || item.categoriaProducto)) {
          return false;
        }

        return true;
      });

      const cantValida = itemsValidos.reduce(
        (sum, item) => sum + (Number(item.cantidad) || 1),
        0
      );
      if (cantValida > 0) {
        eventosCompras.push(cantValida);
      }
    }

    // Agregar compras externas de comida sincronizadas
    for (const cantExt of comprasExternas) {
      eventosCompras.push(cantExt);
    }

    const totalItemsVentas = eventosCompras.reduce((s, c) => s + c, 0);
    const comprasTotales = sellosMisiones + totalItemsVentas;

    // 4. Calcular el progreso del ciclo del contador (0 a 10 con checkpoints en 5 y 10)
    let contador = sellosMisiones;
    if (contador > 5) contador = 5;

    for (const cantidad of eventosCompras) {
      if (contador >= 10) {
        contador = 0;
      }

      const suma = contador + cantidad;

      if (contador < 5 && suma > 5) {
        contador = 5; // Pausa en checkpoint 5
      } else if (suma > 10) {
        contador = 10; // Pausa en checkpoint 10
      } else {
        contador = suma;
      }
    }

    // 5. Guardar en la base de datos ERP
    await this.prisma.clientes.update({
      where: { IDcliente: clienteId },
      data: {
        contador,
        compras: comprasTotales.toString(),
        fecha_y_hora_actualizacion: new Date(),
      },
    });

    // 6. Emitir por WebSocket en tiempo real
    try {
      this.appGateway.emitFidelidadActualizada({
        clienteId,
        cedula: cliente.cedula ? cliente.cedula.toString() : null,
        nombre: cliente.nombre,
        contador,
        comprasTotales,
        hito5: contador >= 5,
        hito10: contador >= 10,
        granizadoDisponible: contador >= 10,
        descuentoIntermedioDisponible: contador >= 5,
        timestamp: new Date().toISOString(),
      });
    } catch (e) {
      // Ignorar fallo de websocket para no interrumpir
    }

    return contador;
  }

  private async actualizarComprasCliente(
    prisma: any,
    clienteId: number,
    ventaId: string,
    productos: any[]
  ): Promise<number> {
    return this.recalcularFidelidadCliente(clienteId);
  }


  async createVentaCompleta(createVentaCompletaDto: CreateVentaCompletaDto & { fechaContableManual?: string }, usuarioId: string) {
    const effectiveTemporalId = createVentaCompletaDto.temporalId || createVentaCompletaDto.venta?.temporalId;
    if (effectiveTemporalId) {
      // 1. Promesa en vuelo (llamada concurrente inmediata): esperar el mismo resultado
      const inFlight = this.inFlightSalesByTemporalId.get(effectiveTemporalId);
      if (inFlight) {
        console.log(`[DEDUP] createVentaCompleta concurrente detectado para temporalId ${effectiveTemporalId}, esperando promesa en vuelo...`);
        return await inFlight;
      }

      // 2. Caché reciente en memoria (30 segundos)
      const cached = this.recentSalesByTemporalId.get(effectiveTemporalId);
      if (cached && (Date.now() - cached.timestamp < 30000)) {
        console.log(`[DEDUP] createVentaCompleta duplicada detectada con temporalId ${effectiveTemporalId}, retornando venta existente ${cached.venta.IDventas}`);
        return cached.venta;
      }

      // 3. Si el temporalId es de tomar un domicilio, verificar si ya tiene venta en BD
      if (effectiveTemporalId.startsWith('tomar-dom-')) {
        const domId = effectiveTemporalId.replace('tomar-dom-', '');
        try {
          const dom = await this.prisma.domicilioWA.findUnique({
            where: { IDdomicilio: domId },
            include: {
              ventaRelacion: {
                include: {
                  ordenVentas: { include: { producto: { include: { categoriaRelacion: true } } } },
                  usuarioRelacion: { select: { IDusuarios: true, nombre: true, email: true } },
                  facturaElectronica: true,
                },
              },
            },
          });
          if (dom?.ventaId && dom.ventaRelacion) {
            console.log(`[DEDUP] Domicilio ${domId} ya tiene venta asociada en BD ${dom.ventaId}, retornando venta.`);
            this.recentSalesByTemporalId.set(effectiveTemporalId, {
              venta: dom.ventaRelacion,
              timestamp: Date.now(),
            });
            return dom.ventaRelacion;
          }
        } catch (dbErr) {
          console.error('[DEDUP] Error comprobando venta de domicilio en BD:', dbErr);
        }
      }
    }

    const executeInner = async () => {
      const { venta, productos, fechaContableManual } = createVentaCompletaDto;

      const usuario = await this.prisma.usuarios.findUnique({
        where: { IDusuarios: usuarioId },
        select: { nombre: true },
      });

      const fechaVenta = new Date();
      const fechaContable = await this.getFechaContable(fechaVenta, fechaContableManual);

      const pedidoGenerado = await this.generatePedidoNumber(
        venta.mesa && venta.mesa !== 'V.R' ? venta.mesa : null,
        usuario?.nombre,
        fechaContable
      );

      if (effectiveTemporalId) {
        this.appGateway.emitToVentas(SocketEvent.VENTA_ID_GENERATED, { temporalId: effectiveTemporalId, pedido: pedidoGenerado });
      }

    // Buscar nombre del cliente si hay clienteId
    let clienteNombre: string | null = null;
    if (venta.clienteId) {
      const clienteData = await this.prisma.clientes.findUnique({
        where: { IDcliente: venta.clienteId },
        select: { nombre: true }
      });
      clienteNombre = clienteData?.nombre ?? null;
    }

    const validMesaId = await this.resolveMesaOrCreate(venta.mesa);

    let totalInputNormalized = Number(venta.totalInput) || 0;
    if (totalInputNormalized > 0 && totalInputNormalized < 100) {
      totalInputNormalized = totalInputNormalized * 1000;
    }

    const ventaData = {
      mesa: validMesaId,
      medioDePago: venta.medioDePago,
      efectivoRecibido: venta.efectivoRecibido,
      devueltas: venta.devueltas,
      banco: venta.medioDePago === 'EFECTIVO' ? null : venta.banco,
      valorDeTransferencia: (venta as any).valorDeTransferencia ?? (venta as any).transferencia ?? (
        venta.medioDePago === 'EFECTIVO Y OTROS' && totalInputNormalized && venta.efectivoRecibido ?
          Math.max(0, totalInputNormalized - Number(venta.efectivoRecibido)) :
        (['TRANSFERENCIA', 'NEQUI', 'DAVIPLATA', 'TARJETA'].includes(venta.medioDePago || '') ? totalInputNormalized : undefined)
      ),
      totalInput: totalInputNormalized,
      descuento: venta.descuento,
      porcentajeDeDescuento: venta.porcentajeDeDescuento,
      abono: venta.abono,
      propina: venta.propina,
      porcentajePropina: venta.porcentajePropina,
      direccion: venta.direccion || null,
      mensaje: venta.mensaje || null,
    };

    let cocinaInicioAtVal: Date | null = null;
    let cocinaFinAtVal: Date | null = null;
    const estInicial = (venta.estado || 'EN_EL_CARRITO').toUpperCase();
    const configNegocio = await this.getConfiguracionNegocioCached();
    const esModoRestaurante = (configNegocio?.modoOperacion || 'GENERAL').toUpperCase() === 'RESTAURANTE';

    const inicioCalculado = (venta as any).cartStartTime ? new Date((venta as any).cartStartTime) : fechaVenta;
    if (estInicial === 'TOMADO') {
      cocinaInicioAtVal = inicioCalculado;
    } else if (estInicial === 'PAGADO') {
      cocinaInicioAtVal = inicioCalculado;
      if (!esModoRestaurante) {
        cocinaFinAtVal = fechaVenta;
      }
    } else if (estInicial === 'ENTREGADO') {
      cocinaInicioAtVal = inicioCalculado;
      cocinaFinAtVal = fechaVenta;
    }

    const ventaCreada = await this.prisma.ventas.create({
      data: {
        ...ventaData,
        pedido: pedidoGenerado,
        estado: venta.estado || 'EN_EL_CARRITO',
        usuario: usuarioId,
        fechaYHora: fechaVenta,
        fecha: fechaContable,
        hora: fechaVenta.toLocaleTimeString('en-US', { timeZone: 'America/Bogota', hour12: false }),
        registroDeTiempo: this.generateTiempoLog(venta.estado || 'EN_EL_CARRITO', (venta as any).cartStartTime),
        clienteId: venta.clienteId || null,
        cliente: clienteNombre,  // Columna "Clente" – nombre en texto
        cocinaInicioAt: cocinaInicioAtVal,
        cocinaFinAt: cocinaFinAtVal,
      } as Prisma.VentasUncheckedCreateInput,
    });

    const ordenesVentas = await Promise.all(
      productos.map(async (producto) => {
        let nombreProducto: string | undefined | null = producto.nombre;
        let categoriaProducto: string | undefined | null = producto.categoria;
        let validProductoId: string | null = null;

        const rawProdId = producto.productoId && String(producto.productoId).trim() !== ''
          ? String(producto.productoId).trim()
          : null;

        if (rawProdId) {
          try {
            const productoData = await this.prisma.productos.findUnique({
              where: { IDproductos: rawProdId },
            });
            if (productoData) {
              validProductoId = productoData.IDproductos;
              nombreProducto = productoData.nombre || undefined;
              categoriaProducto = productoData.categoriaNombre || productoData.categoria || undefined;
            }
          } catch (e) {
            validProductoId = null;
          }
        }

        if (!validProductoId && nombreProducto && nombreProducto.trim() !== '') {
          try {
            const productoByName = await this.prisma.productos.findFirst({
              where: { nombre: { equals: nombreProducto.trim(), mode: 'insensitive' } },
            });
            if (productoByName) {
              validProductoId = productoByName.IDproductos;
              nombreProducto = productoByName.nombre || nombreProducto;
              categoriaProducto = productoByName.categoriaNombre || productoByName.categoria || categoriaProducto || undefined;
            }
          } catch (e) {
            // Ignore fallback error
          }
        }

        // Apply Jornada Comercial to Orderventas
        const orderFechaContable = fechaContable;

        const { seccionCocinaId, categoriaSeccionCocinaId, productoId, ...restProducto } = producto as any;
        if (cocinaFinAtVal !== null) {
          restProducto.estado = 'LISTO';
          restProducto.cantidadPreparada = producto.cantidad || 1;
          restProducto.preparadoAt = fechaVenta;
        } else {
          restProducto.estado = 'PREPARANDO';
        }

        return this.prisma.orderventas.create({
          data: {
            ...restProducto,
            productoId: validProductoId,
            nombre: nombreProducto || 'Producto',
            categoria: categoriaProducto || 'GENERAL',
            nombreProducto: nombreProducto || 'Producto',
            categoriaProducto: categoriaProducto || 'GENERAL',
            imagenUrl: producto.imagenUrl || null,
            IDventas: ventaCreada.IDventas,
            usuarioId,
            fecha: orderFechaContable, // Use accounting date
          } as Prisma.OrderventasCreateInput,
        });
      }),
    );

    // Si hay un cliente asociado, recalcular sus compras/contador y guardar el resultado en la venta
    if (venta.clienteId) {
      const nuevoContador = await this.recalcularFidelidadCliente(venta.clienteId);
      await this.prisma.ventas.update({
        where: { IDventas: ventaCreada.IDventas },
        data: { compras: nuevoContador.toString() } as Prisma.VentasUncheckedUpdateInput,
      });
    }

    this.notificationsService.sendNotification(
      'VENTA_CREATED',
      'Nueva Venta Creada',
      `Se ha creado el pedido ${pedidoGenerado} por $${ventaData.totalInput || 0}`,
      { ventaId: ventaCreada.IDventas }
    );

    // DEDUCCIÓN DE INVENTARIO (en segundo plano asíncrono para responder de inmediato en ~150ms)
    if (venta.estado !== 'RESERVA') {
      this.applyRecipeDeductions(productos, 'salida', 'Descuento por venta').catch((err) =>
        this.logger.error(`Error aplicando deducciones de inventario para venta ${ventaCreada.IDventas}: ${err.message}`),
      );
    }

    // Auto-vincular domicilio si la venta proviene de tomar un domicilio
    if (effectiveTemporalId && effectiveTemporalId.startsWith('tomar-dom-')) {
      const domId = effectiveTemporalId.replace('tomar-dom-', '');
      try {
        await this.prisma.domicilioWA.update({
          where: { IDdomicilio: domId },
          data: {
            ventaId: ventaCreada.IDventas,
            estado: 'TOMADO',
            atendidoAt: fechaVenta,
          },
        });
        this.appGateway.emitDomicilioActualizado({
          IDdomicilio: domId,
          ventaId: ventaCreada.IDventas,
          estado: 'TOMADO',
          atendidoAt: fechaVenta,
        } as any);
      } catch (domErr: any) {
        this.logger.warn(`No se pudo auto-vincular domicilio ${domId} en createVentaCompleta: ${domErr.message}`);
      }
    }

    const resultVenta = await this.prisma.ventas.findUnique({
      where: { IDventas: ventaCreada.IDventas },
      include: {
        ordenVentas: { include: { producto: { include: { categoriaRelacion: true } } } },
        usuarioRelacion: { select: { IDusuarios: true, nombre: true, email: true } },
        facturaElectronica: true,
      },
    });

    this.appGateway.emitToVentas(SocketEvent.REFRESH_VENTAS, { action: 'create', venta: resultVenta });

      return resultVenta;
    };

    if (effectiveTemporalId) {
      const p = executeInner();
      this.inFlightSalesByTemporalId.set(effectiveTemporalId, p);
      try {
        const res = await p;
        if (res) {
          this.recentSalesByTemporalId.set(effectiveTemporalId, {
            venta: res,
            timestamp: Date.now(),
          });
          if (this.recentSalesByTemporalId.size > 200) {
            const nowMs = Date.now();
            for (const [k, v] of this.recentSalesByTemporalId.entries()) {
              if (nowMs - v.timestamp > 45000) this.recentSalesByTemporalId.delete(k);
            }
          }
        }
        return res;
      } finally {
        this.inFlightSalesByTemporalId.delete(effectiveTemporalId);
      }
    }

    return await executeInner();
  }

  async updateVentaCompleta(id: string, updateVentaCompletaDto: CreateVentaCompletaDto & { fechaContableManual?: string }, usuarioId: string) {
    const { venta, productos, fechaContableManual } = updateVentaCompletaDto;

    const ventaExistente = await this.prisma.ventas.findUnique({
      where: { IDventas: id },
    });

    if (!ventaExistente) {
      throw new NotFoundException(`Venta con ID ${id} no encontrada`);
    }

    const fechaContable = fechaContableManual ? 
      await this.getFechaContable(new Date(), fechaContableManual) : 
      ventaExistente.fecha; // Maintain existing if not overridden

    // Buscar nombre del cliente si hay clienteId
    let clienteNombre: string | null = null;
    if (venta.clienteId) {
      const clienteData = await this.prisma.clientes.findUnique({
        where: { IDcliente: venta.clienteId },
        select: { nombre: true }
      });
      clienteNombre = clienteData?.nombre ?? null;
    }

    const estadoToSave = venta.estado || ventaExistente.estado || 'iniciado';
    const nuevoRegistro = this.appendTiempoLog(ventaExistente.registroDeTiempo, estadoToSave);

    const nuevaMesaValue = await this.resolveMesaOrCreate(venta.mesa);

    let pedidoToSave = ventaExistente.pedido;
    if (ventaExistente.pedido) {
      let mesaStr = venta.mesa && venta.mesa !== 'V.R' && venta.mesa !== 'CAJA' ? venta.mesa : 'V.R';
      if (nuevaMesaValue) {
        try {
          const mesaObj = await this.prisma.mesas.findUnique({
            where: { IdMesas: nuevaMesaValue },
          });
          if (mesaObj && mesaObj.nombre) {
            mesaStr = mesaObj.nombre;
          }
        } catch (e) {}
      }
      const partes = ventaExistente.pedido.split('-');
      if (partes.length >= 2 && partes[0] !== mesaStr) {
        partes[0] = mesaStr;
        pedidoToSave = partes.join('-');
      }
    }

    let cocinaInicioAtUpdate = ventaExistente.cocinaInicioAt;
    let cocinaFinAtUpdate = ventaExistente.cocinaFinAt;
    const estUpper = (estadoToSave || '').toUpperCase();
    const configNegocio = await this.prisma.configuracionNegocio.findFirst();
    const esModoRestaurante = (configNegocio?.modoOperacion || 'GENERAL').toUpperCase() === 'RESTAURANTE';

    if (estUpper === 'TOMADO') {
      if (!cocinaInicioAtUpdate) {
        cocinaInicioAtUpdate = new Date();
      }
    } else if (estUpper === 'PAGADO') {
      if (!cocinaInicioAtUpdate) {
        cocinaInicioAtUpdate = new Date();
      }
      const prevEstUpper = (venta.estado || '').toUpperCase();
      if ((!esModoRestaurante || prevEstUpper === 'ENTREGADO' || prevEstUpper === 'LISTO_PARA_ENTREGA') && !cocinaFinAtUpdate) {
        cocinaFinAtUpdate = new Date();
      }
    } else if (estUpper === 'ENTREGADO') {
      if (!cocinaFinAtUpdate) {
        cocinaFinAtUpdate = new Date();
      }
      if (!cocinaInicioAtUpdate) {
        cocinaInicioAtUpdate = ventaExistente.fechaYHora || new Date();
      }
    }

    const ventaData = {
      mesa: nuevaMesaValue,
      pedido: pedidoToSave,
      medioDePago: venta.medioDePago,
      efectivoRecibido: venta.efectivoRecibido,
      devueltas: venta.devueltas,
      banco: venta.medioDePago === 'EFECTIVO' ? null : venta.banco,
      valorDeTransferencia: (venta as any).valorDeTransferencia ?? (venta as any).transferencia ?? (
        venta.medioDePago === 'EFECTIVO Y OTROS' && venta.totalInput && venta.efectivoRecibido ?
          Math.max(0, Number(venta.totalInput) - Number(venta.efectivoRecibido)) :
        (['TRANSFERENCIA', 'NEQUI', 'DAVIPLATA', 'TARJETA'].includes(venta.medioDePago || '') ? Number(venta.totalInput || 0) : undefined)
      ),
      totalInput: venta.totalInput,
      descuento: venta.descuento,
      porcentajeDeDescuento: venta.porcentajeDeDescuento,
      abono: venta.abono,
      estado: estadoToSave,
      fecha: fechaContable,
      clienteId: venta.clienteId || null,
      cliente: clienteNombre,  // Columna "Clente" – nombre en texto
      registroDeTiempo: nuevoRegistro,
      propina: venta.propina,
      porcentajePropina: venta.porcentajePropina,
      cocinaInicioAt: cocinaInicioAtUpdate,
      cocinaFinAt: cocinaFinAtUpdate,
    };

    // Update Venta
    let ventaActualizada = await this.prisma.ventas.update({
      where: { IDventas: id },
      data: ventaData as Prisma.VentasUncheckedUpdateInput,
    });

    // Replace all Orderventas
    const oldOrderventas = await this.prisma.orderventas.findMany({
      where: { IDventas: id },
    });

    const yaEstuvoEnCocina = Boolean(
      ventaExistente.comandaImpresaAt ||
      ventaExistente.cocinaInicioAt ||
      ['TOMADO', 'PREPARANDO', 'LISTO_PARA_ENTREGA', 'ENTREGADO', 'PAGADO'].includes((ventaExistente.estado || '').toUpperCase())
    );

    const oldItemsMap = new Map<string, any>();
    const oldItemsByNameMap = new Map<string, any>();
    const oldItemsByIdOnlyMap = new Map<string, any>();
    const oldItemsByNameOnlyMap = new Map<string, any>();

    for (const ov of oldOrderventas) {
      const comm = (ov.comentarios || '').trim();
      if (ov.productoId) {
        oldItemsMap.set(`${ov.productoId}_${comm}`, ov);
        if (!oldItemsByIdOnlyMap.has(ov.productoId)) {
          oldItemsByIdOnlyMap.set(ov.productoId, ov);
        }
      }
      const normName = (ov.nombre || ov.nombreProducto || '').trim().toLowerCase();
      if (normName) {
        oldItemsByNameMap.set(`${normName}_${comm}`, ov);
        if (!oldItemsByNameOnlyMap.has(normName)) {
          oldItemsByNameOnlyMap.set(normName, ov);
        }
      }
    }

    // REVERSO DE INVENTARIO
    if (ventaExistente.estado !== 'RESERVA') {
      await this.applyRecipeDeductions(oldOrderventas, 'entrada', 'Reverso por edición de venta');
    }

    await this.prisma.orderventas.deleteMany({
      where: { IDventas: id },
    });

    if (productos && productos.length > 0) {
      await Promise.all(
        productos.map(async (producto) => {
          let nombreProducto = producto.nombre;
          let categoriaProducto = producto.categoria;
          let validProductoId: string | null = null;
          const rawProdId = producto.productoId && String(producto.productoId).trim() !== ''
            ? String(producto.productoId).trim()
            : null;

          if (rawProdId) {
            try {
              const productoData = await this.prisma.productos.findFirst({
                where: { IDproductos: rawProdId },
                select: { IDproductos: true, nombre: true, categoria: true, categoriaNombre: true },
              });

              if (productoData) {
                validProductoId = productoData.IDproductos;
                if (!nombreProducto || nombreProducto.trim() === '') {
                  nombreProducto = productoData.nombre;
                }
                if (!categoriaProducto || categoriaProducto.trim() === '') {
                  categoriaProducto = productoData.categoriaNombre || productoData.categoria || undefined;
                }
              }
            } catch (e) {
              validProductoId = null;
            }
          }

          if (!validProductoId && nombreProducto && nombreProducto.trim() !== '') {
            try {
              const productoByName = await this.prisma.productos.findFirst({
                where: { nombre: { equals: nombreProducto.trim(), mode: 'insensitive' } },
                select: { IDproductos: true, nombre: true, categoria: true, categoriaNombre: true },
              });
              if (productoByName) {
                validProductoId = productoByName.IDproductos;
                if (!categoriaProducto || categoriaProducto.trim() === '') {
                  categoriaProducto = productoByName.categoriaNombre || productoByName.categoria || undefined;
                }
              }
            } catch (e) {
              // Ignore fallback error
            }
          }

          const comm = (producto.comentarios || '').trim();
          const effectiveProdId = validProductoId || producto.productoId || '';
          const normName = (nombreProducto || producto.nombre || '').trim().toLowerCase();

          const oldItem =
            (effectiveProdId ? oldItemsMap.get(`${effectiveProdId}_${comm}`) : undefined) ||
            (producto.productoId ? oldItemsMap.get(`${producto.productoId}_${comm}`) : undefined) ||
            (normName ? oldItemsByNameMap.get(`${normName}_${comm}`) : undefined) ||
            (effectiveProdId ? oldItemsByIdOnlyMap.get(effectiveProdId) : undefined) ||
            (producto.productoId ? oldItemsByIdOnlyMap.get(producto.productoId) : undefined) ||
            (normName ? oldItemsByNameOnlyMap.get(normName) : undefined);
          
          let cantidadPreparada = 0;
          let estado = producto.estado || ventaActualizada.estado || 'iniciado';
          let preparadoAt = undefined;
          
          if (oldItem) {
            cantidadPreparada = Math.min(producto.cantidad, oldItem.cantidadPreparada || 0);
            
            if (cantidadPreparada >= producto.cantidad) {
              estado = 'LISTO';
              preparadoAt = oldItem.preparadoAt || new Date();
            } else {
              estado = 'PREPARANDO';
              preparadoAt = null;
            }
          }

          const shouldBeListo = ventaActualizada.estado === 'ENTREGADO' || 
                                ventaActualizada.estado === 'LISTO_PARA_ENTREGA' || 
                                (ventaActualizada.estado === 'PAGADO' && (!esModoRestaurante || ventaExistente.estado === 'ENTREGADO' || cocinaFinAtUpdate !== null));
          if (shouldBeListo) {
            estado = 'LISTO';
            cantidadPreparada = producto.cantidad || 1;
            preparadoAt = preparadoAt || new Date();
          }

          const comandaImpresa = oldItem ? (Boolean(oldItem.comandaImpresa) || yaEstuvoEnCocina) : false;

          const { seccionCocinaId, categoriaSeccionCocinaId, productoId, gramosPapa, ...restProducto } = producto as any;

          return this.prisma.orderventas.create({
            data: {
              ...restProducto,
              productoId: validProductoId,
              nombre: nombreProducto || 'Producto',
              categoria: categoriaProducto || 'GENERAL',
              nombreProducto: nombreProducto || 'Producto',
              categoriaProducto: categoriaProducto || 'GENERAL',
              imagenUrl: producto.imagenUrl || null,
              IDventas: ventaActualizada.IDventas,
              usuarioId,
              fecha: fechaContable,
              cantidadPreparada,
              estado,
              preparadoAt,
              comandaImpresa,
            } as Prisma.OrderventasCreateInput,
          });
        }),
      );

      // APLICACIÓN DE NUEVO INVENTARIO
      if (estadoToSave !== 'RESERVA') {
        await this.applyRecipeDeductions(productos, 'salida', 'Descuento por venta editada');
      }
    }

    const updatedVentaWithOrders = await this.prisma.ventas.findUnique({
      where: { IDventas: id },
      include: { ordenVentas: true },
    });

    if (updatedVentaWithOrders) {
      if (estadoToSave === 'PAGADO' || estadoToSave === 'COBRADO') {
        try {
          await this.prisma.domicilioWA.updateMany({
            where: { ventaId: id },
            data: { estado: 'COBRADO' },
          });
        } catch (e) {}
        this.dispararSincronizacionFidelidadExterna(id, 'PAGADO').catch(() => {});
      }
      this.appGateway.emitToVentas(SocketEvent.REFRESH_VENTAS, { action: 'updateEstado', venta: updatedVentaWithOrders });
    }

    // Recalcular fidelidad para el cliente actual
    if (venta.clienteId) {
      const nuevoContador = await this.recalcularFidelidadCliente(venta.clienteId);
      await this.prisma.ventas.update({
        where: { IDventas: id },
        data: { compras: nuevoContador.toString() } as Prisma.VentasUncheckedUpdateInput,
      });
    }

    // Si el cliente cambió respecto al anterior, recalcular también al cliente previo
    if (ventaExistente.clienteId && ventaExistente.clienteId !== venta.clienteId) {
      await this.recalcularFidelidadCliente(ventaExistente.clienteId);
    }

    return updatedVentaWithOrders;
  }

  async ajustarProductoEnVenta(ventaId: string, orderVentaId: string, nuevaCantidad: number, usuarioId: string) {
    const venta = await this.prisma.ventas.findUnique({
      where: { IDventas: ventaId },
      include: { ordenVentas: true },
    });

    if (!venta) {
      throw new NotFoundException(`Venta con ID ${ventaId} no encontrada`);
    }

    const orderVenta = venta.ordenVentas.find((ov) => ov.IDorderventas === orderVentaId);
    if (!orderVenta) {
      throw new NotFoundException(`Producto de venta con ID ${orderVentaId} no encontrado en la venta ${ventaId}`);
    }

    const cantidadAnterior = Number(orderVenta.cantidad) || 0;
    const diff = nuevaCantidad - cantidadAnterior;

    if (diff === 0) {
      return venta; // No changes
    }

    // Actualizar o eliminar OrderVenta
    if (nuevaCantidad <= 0) {
      await this.prisma.orderventas.delete({
        where: { IDorderventas: orderVentaId },
      });
    } else {
      const nuevoPrecioTotal = Number(orderVenta.precio || 0) * nuevaCantidad;
      await this.prisma.orderventas.update({
        where: { IDorderventas: orderVentaId },
        data: {
          cantidad: nuevaCantidad,
          precioTotal: nuevoPrecioTotal,
        },
      });
    }

    // Recalcular totalInput de la Venta
    const remainingOrders = await this.prisma.orderventas.findMany({
      where: { IDventas: ventaId },
    });
    
    let totalModifiers = 0;
    remainingOrders.forEach(order => {
      try {
        if ((order as any).modificadores) {
          const parsedModifiers = typeof (order as any).modificadores === 'string' ? JSON.parse((order as any).modificadores) : (order as any).modificadores;
          if (Array.isArray(parsedModifiers)) {
            parsedModifiers.forEach((m: any) => {
              totalModifiers += (Number(m.precio || m.Precio || m.price || 0)) * (Number(m.cantidad || 1));
            });
          }
        }
      } catch (error) {
        console.error('Error parseando modificadores', error);
      }
    });

    const nuevoTotalInput = remainingOrders.reduce((acc, order) => acc + (Number(order.precioTotal) || 0), 0);
    const totalDescuento = Number(venta.descuento || 0);

    const finalTotalInput = Math.max(0, nuevoTotalInput + totalModifiers - totalDescuento);

    const ventaActualizada = await this.prisma.ventas.update({
      where: { IDventas: ventaId },
      data: {
        totalInput: finalTotalInput,
      },
      include: { ordenVentas: true },
    });

    // Actualizar inventario
    if (venta.estado !== 'RESERVA') {
      const absDiff = Math.abs(diff);
      const tipoMovimiento = diff < 0 ? 'entrada' : 'salida';
      const motivo = diff < 0 ? 'Reverso por cuadre de caja' : 'Adición por cuadre de caja';

      await this.applyRecipeDeductions(
        [{ ...orderVenta, cantidad: absDiff } as any],
        tipoMovimiento,
        motivo
      );
    }

    // Emit event
    this.appGateway.emitToVentas(SocketEvent.REFRESH_VENTAS, { action: 'updateEstado', venta: ventaActualizada });

    if (venta.clienteId) {
      await this.recalcularFidelidadCliente(venta.clienteId);
    }

    return ventaActualizada;
  }

  async actualizarEstadoProducto(ventaId: string, orderVentaId: string, estado: string, cantidadPreparada?: number) {
    const venta = await this.prisma.ventas.findUnique({
      where: { IDventas: ventaId },
      include: { ordenVentas: true },
    });

    if (!venta) {
      throw new NotFoundException(`Venta con ID ${ventaId} no encontrada`);
    }

    const orderVenta = venta.ordenVentas.find((ov) => ov.IDorderventas === orderVentaId);
    if (!orderVenta) {
      throw new NotFoundException(`Producto de venta con ID ${orderVentaId} no encontrado en la venta ${ventaId}`);
    }

    let finalEstado = estado;
    let finalCantidadPreparada = cantidadPreparada !== undefined ? cantidadPreparada : (estado === 'LISTO' ? (orderVenta.cantidad || 1) : 0);
    
    if (orderVenta.cantidad && finalCantidadPreparada >= orderVenta.cantidad) {
      finalEstado = 'LISTO';
      finalCantidadPreparada = orderVenta.cantidad;
    } else if (finalCantidadPreparada < (orderVenta.cantidad || 1)) {
      finalEstado = 'PREPARANDO';
    }

    const preparadoAt = finalEstado === 'LISTO' ? new Date() : null;

    await this.prisma.orderventas.update({
      where: { IDorderventas: orderVentaId },
      data: { estado: finalEstado, preparadoAt, cantidadPreparada: finalCantidadPreparada },
    });

    const ventaActualizada = await this.prisma.ventas.findUnique({
      where: { IDventas: ventaId },
      include: { ordenVentas: true },
    });

    this.appGateway.emitToVentas(SocketEvent.REFRESH_VENTAS, { action: 'updateEstado', venta: ventaActualizada });

    return ventaActualizada;
  }

  async findAll(query: VentaQueryDto) {
    const { 
      page = 1, 
      limit = 20, 
      estado, 
      usuario, 
      mesa, 
      fechaDesde, 
      fechaHasta, 
      medioDePago, 
      includeDeleted, 
      search,
      totalMin,
      totalMax,
      productoId,
      categoriaProducto,
      clienteId,
      banco
    } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.VentasWhereInput = {};
    
    // Only filter by deletedAt: null if includeDeleted is not explicitly 'true'
    if (includeDeleted !== 'true' && includeDeleted !== true) {
      where.deletedAt = null;
    } else {
      where.deletedAt = { not: null }; // If includeDeleted is true, we ONLY want deleted ones (for the "Eliminadas" tab)
    }

    if (search) {
      const orConditions: Prisma.VentasWhereInput[] = [];

      // 1. Search for the exact phrase in major fields
      orConditions.push(
        { pedido: { contains: search, mode: 'insensitive' } },
        { cliente: { contains: search, mode: 'insensitive' } },
        { mensaje: { contains: search, mode: 'insensitive' } },
        { ordenVentas: { some: { nombre: { contains: search, mode: 'insensitive' } } } },
        { ordenVentas: { some: { comentarios: { contains: search, mode: 'insensitive' } } } }
      );

      // 2. Search for individual words (length > 2) to be very thorough
      const words = search.split(/\s+/).map(w => w.trim()).filter(w => w.length > 2);
      for (const word of words) {
        orConditions.push(
          { pedido: { contains: word, mode: 'insensitive' } },
          { cliente: { contains: word, mode: 'insensitive' } },
          { mensaje: { contains: word, mode: 'insensitive' } },
          { ordenVentas: { some: { nombre: { contains: word, mode: 'insensitive' } } } },
          { ordenVentas: { some: { comentarios: { contains: word, mode: 'insensitive' } } } }
        );
      }

      // 3. Search for numbers (e.g. totalInput, precioTotal, or strings in comentarios)
      const numberMatches = search.match(/-?\d+([.,]\d+)?/g) || [];
      for (const numStr of numberMatches) {
        let cleanedNumStr = numStr;
        if (/([.,]\d{3})$/.test(numStr)) {
          cleanedNumStr = numStr.replace(/[.]/g, ''); // Remove thousand dot separator
        } else {
          cleanedNumStr = numStr.replace(/,/g, '.'); // Normalize decimal comma to dot
        }
        const parsedNum = parseFloat(cleanedNumStr);
        if (!isNaN(parsedNum)) {
          orConditions.push(
            { totalInput: { equals: parsedNum } },
            { totalInput: { equals: Math.abs(parsedNum) } },
            { ordenVentas: { some: { precioTotal: { equals: parsedNum } } } },
            { ordenVentas: { some: { precioTotal: { equals: Math.abs(parsedNum) } } } },
            { ordenVentas: { some: { precio: { equals: parsedNum } } } },
            { ordenVentas: { some: { precio: { equals: Math.abs(parsedNum) } } } },
            { ordenVentas: { some: { comentarios: { contains: cleanedNumStr, mode: 'insensitive' } } } },
            { ordenVentas: { some: { comentarios: { contains: Math.abs(parsedNum).toString(), mode: 'insensitive' } } } }
          );
        }
      }

      // 4. Special cases: "nota", "notas", "con nota", "con notas"
      const searchLower = search.toLowerCase().trim();
      if (['nota', 'notas', 'con nota', 'con notas', 'comentario', 'comentarios', 'mensaje', 'mensajes'].includes(searchLower)) {
        orConditions.push(
          { AND: [ { mensaje: { not: null } }, { mensaje: { not: "" } } ] },
          { ordenVentas: { some: { AND: [ { comentarios: { not: null } }, { comentarios: { not: "" } } ] } } }
        );
      }

      where.OR = orConditions;
    }

    if (categoriaProducto) {
      const categorias = categoriaProducto.split(',');
      where.ordenVentas = {
        ...((where.ordenVentas as any) || {}),
        some: {
          ...(((where.ordenVentas as any)?.some) || {}),
          categoriaProducto: categorias.length > 1 ? { in: categorias } : categorias[0]
        }
      };
    }

    if (estado) {
      const estados = estado.split(',');
      if (estados.length > 1) {
        where.estado = { in: estados };
      } else {
        where.estado = estado;
      }
    }

    if (usuario) {
      where.usuario = usuario;
    }

    if (mesa) {
      where.mesa = mesa;
    }

    if (medioDePago) {
      const medios = medioDePago.split(',');
      where.AND = [
        ...(Array.isArray(where.AND) ? where.AND : (where.AND ? [where.AND] : [])),
        {
          OR: medios.map(m => ({
            OR: [
              { medioDePago: { contains: m, mode: 'insensitive' } },
              { banco: { contains: m, mode: 'insensitive' } }
            ]
          }))
        }
      ];
    }

    if (banco) {
      const bancos = banco.split(',');
      where.AND = [
        ...(Array.isArray(where.AND) ? where.AND : (where.AND ? [where.AND] : [])),
        {
          OR: bancos.map(b => ({ banco: { contains: b, mode: 'insensitive' } }))
        }
      ];
    }

    if (fechaDesde || fechaHasta) {
      where.fecha = {};
      if (fechaDesde) {
        where.fecha.gte = new Date(fechaDesde);
      }
      if (fechaHasta) {
        where.fecha.lte = new Date(fechaHasta);
      }
    }

    if (totalMin !== undefined || totalMax !== undefined) {
      where.totalInput = {};
      if (totalMin !== undefined && totalMin !== '') {
        where.totalInput.gte = Number(totalMin);
      }
      if (totalMax !== undefined && totalMax !== '') {
        where.totalInput.lte = Number(totalMax);
      }
    }

    if (productoId) {
      where.ordenVentas = {
        some: {
          ...(productoId ? { productoId } : {})
        }
      };
    }

    if (clienteId) {
      where.clienteId = Number(clienteId);
    }

    const [data, total] = await Promise.all([
      this.prisma.ventas.findMany({
        where,
        skip,
        take: limit,
        orderBy: { fechaYHora: 'desc' },
        include: {
          ordenVentas: {
            include: {
              producto: {
                select: { 
                  IDproductos: true, 
                  nombre: true, 
                  categoriaNombre: true, 
                  categoria: true, 
                  imagenUrl: true, 
                  image: true, 
                  seccionCocinaId: true,
                  categoriaRelacion: { select: { seccionCocinaId: true } },
                  recetaInsumos: {
                    include: {
                      insumoRelacion: {
                        select: { nombre: true, unidades: true, cantidadPorPaquete: true }
                      }
                    }
                  }
                },
              },
            },
          },
          usuarioRelacion: {
            select: { IDusuarios: true, nombre: true, email: true },
          },
          clienteRelacion: {
            select: { IDcliente: true, nombre: true, cedula: true, whatsapp: true, compras: true, contador: true }
          },
          facturaElectronica: true,
        },
      }),
      this.prisma.ventas.count({ where }),
    ]);

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
        hasNextPage: page < Math.ceil(total / limit),
        hasPreviousPage: page > 1,
      },
    };
  }

  async findOne(id: string) {
    const venta = await this.prisma.ventas.findFirst({
      where: { IDventas: id, deletedAt: null },
      include: {
        ordenVentas: {
          include: {
            producto: {
              include: { 
                categoriaRelacion: true,
                recetaInsumos: {
                  include: {
                    insumoRelacion: {
                      select: { nombre: true, unidades: true, cantidadPorPaquete: true }
                    }
                  }
                }
              }
            },
          },
        },
        usuarioRelacion: true,
        facturaElectronica: true,
      },
    });

    if (!venta) {
      throw new NotFoundException(`Venta con ID ${id} no encontrada`);
    }

    return venta;
  }

  async updateEstado(id: string, estado: string) {
    const venta = await this.prisma.ventas.findFirst({
      where: { IDventas: id, deletedAt: null },
    });

    if (!venta) {
      throw new NotFoundException(`Venta con ID ${id} no encontrada`);
    }

    const nuevoRegistro = this.appendTiempoLog(venta.registroDeTiempo, estado);

    let cocinaInicioAtUpdate = venta.cocinaInicioAt;
    let cocinaFinAtUpdate = venta.cocinaFinAt;
    const estUpper = (estado || '').toUpperCase();
    const configNegocio = await this.prisma.configuracionNegocio.findFirst();
    const esModoRestaurante = (configNegocio?.modoOperacion || 'GENERAL').toUpperCase() === 'RESTAURANTE';

    if (estUpper === 'TOMADO') {
      if (!cocinaInicioAtUpdate) {
        cocinaInicioAtUpdate = new Date();
      }
    } else if (estUpper === 'PAGADO') {
      if (!cocinaInicioAtUpdate) {
        cocinaInicioAtUpdate = new Date();
      }
      const prevEstUpper = (venta.estado || '').toUpperCase();
      if ((!esModoRestaurante || prevEstUpper === 'ENTREGADO' || prevEstUpper === 'LISTO_PARA_ENTREGA') && !cocinaFinAtUpdate) {
        cocinaFinAtUpdate = new Date();
      }
    } else if (estUpper === 'ENTREGADO') {
      if (!cocinaFinAtUpdate) {
        cocinaFinAtUpdate = new Date();
      }
      if (!cocinaInicioAtUpdate) {
        cocinaInicioAtUpdate = venta.fechaYHora || new Date();
      }
    }

    const shouldMarkItemsListo = estUpper === 'ENTREGADO' || 
                                 estUpper === 'LISTO_PARA_ENTREGA' || 
                                 (estUpper === 'PAGADO' && (!esModoRestaurante || venta.estado === 'ENTREGADO' || cocinaFinAtUpdate !== null));

    if (shouldMarkItemsListo) {
      const orderItems = await this.prisma.orderventas.findMany({ where: { IDventas: id } });
      if (orderItems.length > 0) {
        await Promise.all(
          orderItems.map(ov =>
            this.prisma.orderventas.update({
              where: { IDorderventas: ov.IDorderventas },
              data: {
                estado: 'LISTO',
                cantidadPreparada: ov.cantidad || 1,
                preparadoAt: ov.preparadoAt || new Date(),
              }
            })
          )
        );
      }
    }

    const isOldActive = venta.estado !== 'RESERVA' && venta.estado !== 'CANCELADO' && venta.estado !== 'ANULADO';
    const isNewActive = estado !== 'RESERVA' && estado !== 'CANCELADO' && estado !== 'ANULADO';

    if (!isOldActive && isNewActive) {
      const orderItems = await this.prisma.orderventas.findMany({ where: { IDventas: id } });
      await this.applyRecipeDeductions(orderItems, 'salida', 'Descuento al pasar a estado activo');
    } else if (isOldActive && !isNewActive) {
      const orderItems = await this.prisma.orderventas.findMany({ where: { IDventas: id } });
      await this.applyRecipeDeductions(orderItems, 'entrada', 'Reverso al pasar a estado inactivo (cancelado/anulado/reserva)');
    }

    await this.prisma.ventas.update({
      where: { IDventas: id },
      data: {
        estado,
        registroDeTiempo: nuevoRegistro,
        cocinaInicioAt: cocinaInicioAtUpdate,
        cocinaFinAt: cocinaFinAtUpdate,
      },
    });

    if (estado === 'PAGADO' || estado === 'COBRADO') {
      try {
        await this.prisma.domicilioWA.updateMany({
          where: { ventaId: id },
          data: { estado: 'COBRADO' },
        });
      } catch (e) {}
      this.dispararSincronizacionFidelidadExterna(id, 'PAGADO').catch(() => {});
    } else if (estado === 'CANCELADO' || estado === 'ANULADO') {
      this.dispararSincronizacionFidelidadExterna(id, 'ANULADO').catch(() => {});
      try {
        await this.prisma.domicilioWA.updateMany({
          where: { ventaId: id },
          data: { estado: 'CANCELADO' },
        });
      } catch (e) {}
    }

    // FIX: fetch with ordenVentas so the frontend never receives a payload
    // that overwrites the products/totalInput with stale/incomplete data.
    const updated = await this.prisma.ventas.findUnique({
      where: { IDventas: id },
      include: {
        ordenVentas: { 
          include: { 
            producto: { 
              include: { 
                categoriaRelacion: true,
                recetaInsumos: {
                  include: {
                    insumoRelacion: {
                      select: { nombre: true, unidades: true, cantidadPorPaquete: true }
                    }
                  }
                }
              } 
            } 
          } 
        },
        usuarioRelacion: { select: { IDusuarios: true, nombre: true, email: true } },
        facturaElectronica: true,
      },
    });

    this.appGateway.emitToVentas(SocketEvent.REFRESH_VENTAS, { action: 'updateEstado', venta: updated });

    if (venta.clienteId) {
      await this.recalcularFidelidadCliente(venta.clienteId);
    }

    return updated;
  }

  async calcularTiempoTotal(id: string) {
    const venta = await this.prisma.ventas.findUnique({
      where: { IDventas: id },
      select: { registroDeTiempo: true, estado: true }
    });

    if (!venta) {
      throw new NotFoundException(`Venta con ID ${id} no encontrada`);
    }

    const log: any[] = Array.isArray(venta.registroDeTiempo) ? venta.registroDeTiempo : [];
    if (log.length === 0) return { tiempoTotalFormat: '00:00:00:00', estadoActual: venta.estado };

    let totalMs = 0;
    let activeStart: number | null = null;
    const activeStates = ['TOMADO', 'PREPARANDO', 'LISTO_PARA_ENTREGA', 'LISTO'];

    for (let i = 0; i < log.length; i++) {
      const entry = log[i];
      const time = new Date(entry.fecha_hora).getTime();
      
      if (activeStates.includes(entry.estado)) {
        if (activeStart === null) {
          activeStart = time;
        }
      } else {
        if (activeStart !== null) {
          totalMs += Math.max(0, time - activeStart);
          activeStart = null;
        }
      }
    }
    
    if (activeStart !== null) {
      const endTime = log.length > 1 ? new Date(log[log.length - 1].fecha_hora).getTime() : Date.now();
      totalMs += Math.max(0, endTime - activeStart);
    }
    
    const diffMs = totalMs;

    return {
      tiempoTotalFormat: this.formatDuration(diffMs),
      estadoActual: venta.estado,
      historial: log
    };
  }

  async updatePago(id: string, updateData: any) {
    const venta = await this.prisma.ventas.findFirst({
      where: { IDventas: id, deletedAt: null },
    });

    if (!venta) {
      throw new NotFoundException(`Venta con ID ${id} no encontrada`);
    }

    const estadoUpdate = updateData.estado || 'PAGADO';
    const nuevoRegistro = this.appendTiempoLog(venta.registroDeTiempo, estadoUpdate);

    let cocinaInicioAtUpdate = venta.cocinaInicioAt;
    let cocinaFinAtUpdate = venta.cocinaFinAt;
    const estUpper = (estadoUpdate || '').toUpperCase();
    const configNegocio = await this.prisma.configuracionNegocio.findFirst();
    const esModoRestaurante = (configNegocio?.modoOperacion || 'GENERAL').toUpperCase() === 'RESTAURANTE';

    if (estUpper === 'TOMADO') {
      if (!cocinaInicioAtUpdate) {
        cocinaInicioAtUpdate = new Date();
      }
    } else if (estUpper === 'PAGADO') {
      if (!cocinaInicioAtUpdate) {
        cocinaInicioAtUpdate = new Date();
      }
      const prevEstUpper = (venta.estado || '').toUpperCase();
      if ((!esModoRestaurante || prevEstUpper === 'ENTREGADO' || prevEstUpper === 'LISTO_PARA_ENTREGA') && !cocinaFinAtUpdate) {
        cocinaFinAtUpdate = new Date();
      }
    } else if (estUpper === 'ENTREGADO') {
      if (!cocinaFinAtUpdate) {
        cocinaFinAtUpdate = new Date();
      }
      if (!cocinaInicioAtUpdate) {
        cocinaInicioAtUpdate = venta.fechaYHora || new Date();
      }
    }

    const shouldMarkItemsListo = estUpper === 'ENTREGADO' || 
                                 estUpper === 'LISTO_PARA_ENTREGA' || 
                                 (estUpper === 'PAGADO' && (!esModoRestaurante || venta.estado === 'ENTREGADO' || cocinaFinAtUpdate !== null));

    if (shouldMarkItemsListo) {
      const orderItems = await this.prisma.orderventas.findMany({ where: { IDventas: id } });
      if (orderItems.length > 0) {
        await Promise.all(
          orderItems.map(ov =>
            this.prisma.orderventas.update({
              where: { IDorderventas: ov.IDorderventas },
              data: {
                estado: 'LISTO',
                cantidadPreparada: ov.cantidad || 1,
                preparadoAt: ov.preparadoAt || new Date()
              }
            })
          )
        );
      }
    }

    const isOldActive = venta.estado !== 'RESERVA' && venta.estado !== 'CANCELADO' && venta.estado !== 'ANULADO';
    const isNewActive = estadoUpdate !== 'RESERVA' && estadoUpdate !== 'CANCELADO' && estadoUpdate !== 'ANULADO';

    if (!isOldActive && isNewActive) {
      const orderItems = await this.prisma.orderventas.findMany({ where: { IDventas: id } });
      await this.applyRecipeDeductions(orderItems, 'salida', 'Descuento al pasar a estado activo');
    } else if (isOldActive && !isNewActive) {
      const orderItems = await this.prisma.orderventas.findMany({ where: { IDventas: id } });
      await this.applyRecipeDeductions(orderItems, 'entrada', 'Reverso al pasar a estado inactivo (cancelado/anulado/reserva)');
    }

    await this.prisma.ventas.update({
      where: { IDventas: id },
      data: {
        estado: estadoUpdate,
        medioDePago: updateData.medioDePago,
        efectivoRecibido: updateData.efectivoRecibido,
        devueltas: updateData.devueltas,
        banco: updateData.banco,
        valorDeTransferencia: (updateData as any).valorDeTransferencia ?? (updateData as any).transferencia ?? (
          updateData.medioDePago === 'EFECTIVO Y OTROS' && updateData.totalInput && updateData.efectivoRecibido ?
            Math.max(0, Number(updateData.totalInput) - Number(updateData.efectivoRecibido)) :
          (['TRANSFERENCIA', 'NEQUI', 'DAVIPLATA', 'TARJETA'].includes(updateData.medioDePago || '') ? Number(updateData.totalInput || 0) : undefined)
        ),
        totalInput: updateData.totalInput,
        descuento: updateData.descuento,
        porcentajeDeDescuento: updateData.porcentajeDeDescuento,
        abono: updateData.abono,
        propina: updateData.propina,
        porcentajePropina: updateData.porcentajePropina,
        registroDeTiempo: nuevoRegistro,
        cocinaInicioAt: cocinaInicioAtUpdate,
        cocinaFinAt: cocinaFinAtUpdate,
        clienteId: updateData.clienteId !== undefined ? (updateData.clienteId ? Number(updateData.clienteId) : null) : venta.clienteId,
        cliente: updateData.cliente !== undefined ? updateData.cliente : venta.cliente,
      },
    });

    const effectiveClienteId = (updateData.clienteId ? Number(updateData.clienteId) : null) || venta.clienteId;
    if (effectiveClienteId && (estadoUpdate === 'PAGADO' || estadoUpdate === 'COBRADO')) {
      try {
        await this.recalcularFidelidadCliente(effectiveClienteId);
      } catch (err: any) {
        this.logger.error('Error al recalcular fidelidad tras cobrar: ' + (err?.message || err));
      }
    }

    // FIX: always emit with full ordenVentas to prevent frontend stale-data issues
    const updated = await this.prisma.ventas.findUnique({
      where: { IDventas: id },
      include: {
        ordenVentas: { include: { producto: { include: { categoriaRelacion: true } } } },
        usuarioRelacion: { select: { IDusuarios: true, nombre: true, email: true } },
        facturaElectronica: true,
      },
    });

    if (estadoUpdate === 'PAGADO' || estadoUpdate === 'COBRADO') {
      try {
        await this.prisma.domicilioWA.updateMany({
          where: { ventaId: id },
          data: { estado: 'COBRADO' },
        });
      } catch (e) {}
    }

    this.appGateway.emitToVentas(SocketEvent.REFRESH_VENTAS, { action: 'updateEstado', venta: updated });
    
    if (updated && (updateData.estado === 'PAGADO' || (!updateData.estado && updated.estado === 'PAGADO'))) {
      const config = await this.prisma.configuracionNegocio.findFirst();
      if (config?.emitirFacturaAutomatica) {
        this.facturacionService.emitirFactura(id).catch(err => {
          console.error('Error en emisión automática de factura', err);
        });
      }
    }

    return updated;
  }

  async addProductosToVenta(id: string, productos: CreateOrderVentaDto[]) {
    const venta = await this.prisma.ventas.findFirst({
      where: { IDventas: id, deletedAt: null },
      include: { ordenVentas: true },
    });

    if (!venta) {
      throw new NotFoundException(`Venta con ID ${id} no encontrada`);
    }

    const newProducts = await Promise.all(
      productos.map((producto) =>
        this.prisma.orderventas.create({
          data: {
            IDventas: id,
            nombre: producto.nombre,
            nombreProducto: producto.nombreProducto || producto.nombre,
            categoria: producto.categoria || 'LO MAS VENDIDO',
            categoriaProducto: producto.categoriaProducto || producto.categoria || 'LO MAS VENDIDO',
            cantidad: producto.cantidad,
            precio: producto.precio,
            precioTotal: producto.precioTotal,
            estado: producto.estado || 'EN_EL_CARRITO',
            productoId: producto.productoId,
            comentarios: producto.comentarios,
            salsa: producto.salsa,
            helado: producto.helado,
            topings: producto.topings,
            imagenUrl: producto.imagenUrl,
          },
        }),
      ),
    );

    const allProducts = [...venta.ordenVentas, ...newProducts];
    const sumProducts = allProducts.reduce((sum, p) => sum + Number(p.precioTotal || 0), 0);
    const newTotal = sumProducts - Number(venta.descuento || 0);

    const updatedVenta = await this.prisma.ventas.update({
      where: { IDventas: id },
      data: { totalInput: newTotal > 0 ? newTotal : 0 },
      include: { ordenVentas: true },
    });

    // DEDUCCIÓN DE INVENTARIO PARA PRODUCTOS AGREGADOS
    await this.applyRecipeDeductions(productos, 'salida', 'Descuento por agregar producto');

    this.appGateway.emitToVentas(SocketEvent.REFRESH_VENTAS, { action: 'updateEstado', venta: updatedVenta });

    if (venta.clienteId) {
      await this.recalcularFidelidadCliente(venta.clienteId);
    }

    return updatedVenta;
  }

  async findByMesa(mesaId: string) {
    return this.prisma.ventas.findMany({
      where: {
        mesa: mesaId,
        estado: { in: ['EN_EL_CARRITO', 'TOMADO', 'LISTO_PARA_ENTREGA'] },
        deletedAt: null,
      },
      include: {
        ordenVentas: true,
        facturaElectronica: true,
      },
      orderBy: { fechaYHora: 'desc' },
    });
  }

  async findVentasHoy() {
    const hoyContable = await this.getFechaContable(new Date());

    return this.prisma.ventas.findMany({
      where: {
        fecha: hoyContable,
        estado: { in: ['PAGADO', 'ENTREGADO'] },
        deletedAt: null,
      },
      include: {
        ordenVentas: {
          include: {
            producto: {
              select: { IDproductos: true, nombre: true, categoriaNombre: true, categoria: true, imagenUrl: true, image: true },
            },
          },
        },
        facturaElectronica: true,
      },
    });
  }

  async remove(id: string, usuarioId: string, reason?: string) {
    const venta = await this.prisma.ventas.findFirst({
      where: { IDventas: id, deletedAt: null },
    });

    if (!venta) {
      throw new NotFoundException(`Venta con ID ${id} no encontrada`);
    }

    if (venta.estado === 'COMPLETADO' || venta.estado === 'EN_PROCESO') {
      // In a real scenario, check if user has special auth. Here, we assume the Admin guard handles it.
    }

    // Logic to maintain database integrity: When a sale is soft-deleted,
    // we also hard delete its items (Orderventas) so they don't appear in 
    // inventory queries or raw CSV exports as valid active items.
    // If you need them for audit, you could add deletedAt to Orderventas in the future,
    // but currently the easiest robust fix is deleting them.

    const oldOrderventas = await this.prisma.orderventas.findMany({
      where: { IDventas: id },
    });

    // REVERSO DE INVENTARIO
    if (venta.estado !== 'RESERVA') {
      await this.applyRecipeDeductions(oldOrderventas, 'entrada', 'Reverso por anulación de venta');
    }

    await this.prisma.orderventas.deleteMany({
      where: { IDventas: id },
    });

    const result = await this.prisma.ventas.update({
      where: { IDventas: id },
      data: {
        deletedAt: new Date(),
        deletedBy: usuarioId,
        deleteReason: reason || 'Eliminación manual',
      },
    });

    this.notificationsService.sendNotification(
      'VENTA_DELETED',
      'Venta Eliminada/Anulada',
      `Se ha anulado el pedido ${venta.pedido || id}. Motivo: ${reason || 'Eliminación manual'}`,
      { ventaId: id }
    );

    this.appGateway.emitToVentas(SocketEvent.REFRESH_VENTAS, { action: 'delete', ventaId: id, venta });

    if (venta.clienteId) {
      await this.recalcularFidelidadCliente(venta.clienteId);
    }
    this.dispararSincronizacionFidelidadExterna(id, 'ANULADO').catch(() => {});

    return result;
  }

  async removeBulk(ids: string[], usuarioId: string, reason?: string) {
    const activeVentas = await this.prisma.ventas.findMany({ where: { IDventas: { in: ids } } });
    const nonReservaIds = activeVentas.filter(v => v.estado !== 'RESERVA').map(v => v.IDventas);

    // REVERSO DE INVENTARIO PARA TODAS LAS VENTAS (excepto RESERVA)
    const oldOrderventas = await this.prisma.orderventas.findMany({
      where: { IDventas: { in: nonReservaIds } },
    });
    await this.applyRecipeDeductions(oldOrderventas, 'entrada', 'Reverso por anulación masiva');

    // Intelligently clean up child items first
    await this.prisma.orderventas.deleteMany({
      where: { IDventas: { in: ids } },
    });

    const result = await this.prisma.ventas.updateMany({
      where: {
        IDventas: { in: ids },
        deletedAt: null,
      },
      data: {
        deletedAt: new Date(),
        deletedBy: usuarioId,
        deleteReason: reason || 'Eliminación masiva',
      },
    });

    this.appGateway.emitToVentas(SocketEvent.REFRESH_VENTAS, { action: 'bulkDelete', ventaIds: ids, count: result.count });

    const clienteIds = [...new Set(activeVentas.map((v) => v.clienteId).filter(Boolean))] as number[];
    for (const cid of clienteIds) {
      await this.recalcularFidelidadCliente(cid);
    }

    return { count: result.count };
  }

  async restore(id: string) {
    const venta = await this.prisma.ventas.findFirst({
      where: { IDventas: id, deletedAt: { not: null } },
    });

    if (!venta) {
      throw new NotFoundException(`Venta eliminada con ID ${id} no encontrada`);
    }

    const orderventas = await this.prisma.orderventas.findMany({
      where: { IDventas: id },
    });

    // DEDUCCIÓN DE INVENTARIO (Vuelve a restar al restaurar)
    await this.applyRecipeDeductions(orderventas, 'salida', 'Descuento por restauración de venta');

    const restored = await this.prisma.ventas.update({
      where: { IDventas: id },
      data: {
        deletedAt: null,
        deletedBy: null,
        deleteReason: null,
      },
    });

    this.appGateway.emitToVentas(SocketEvent.REFRESH_VENTAS, { action: 'restore', venta: restored });

    if (venta.clienteId) {
      await this.recalcularFidelidadCliente(venta.clienteId);
    }

    return restored;
  }

  async hardDelete(id: string) {
    const venta = await this.prisma.ventas.findFirst({
      where: { IDventas: id },
    });

    if (!venta) {
      throw new NotFoundException(`Venta con ID ${id} no encontrada`);
    }

    if (venta.deletedAt === null && venta.estado !== 'RESERVA') {
      const oldOrderventas = await this.prisma.orderventas.findMany({
        where: { IDventas: id },
      });
      await this.applyRecipeDeductions(oldOrderventas, 'entrada', 'Reverso por hard-delete');
    }

    // Intelligently clean up child items first just in case
    await this.prisma.orderventas.deleteMany({
      where: { IDventas: id },
    });

    const result = await this.prisma.ventas.delete({
      where: { IDventas: id },
    });

    // Emit socket so all clients remove the sale from their local state immediately
    this.appGateway.emitToVentas(SocketEvent.REFRESH_VENTAS, { action: 'delete', ventaId: id, venta });

    if (venta.clienteId) {
      await this.recalcularFidelidadCliente(venta.clienteId);
    }

    return result;
  }

  async hardDeleteBulk(ids: string[]) {
    const activeVentas = await this.prisma.ventas.findMany({
      where: { IDventas: { in: ids }, deletedAt: null },
    });

    if (activeVentas.length > 0) {
      const activeIds = activeVentas.filter(v => v.estado !== 'RESERVA').map(v => v.IDventas);
      const oldOrderventas = await this.prisma.orderventas.findMany({
        where: { IDventas: { in: activeIds } },
      });
      await this.applyRecipeDeductions(oldOrderventas, 'entrada', 'Reverso por hard-delete masivo');
    }

    // Intelligently clean up child items first
    await this.prisma.orderventas.deleteMany({
      where: { IDventas: { in: ids } },
    });

    const result = await this.prisma.ventas.deleteMany({
      where: { IDventas: { in: ids } },
    });

    // Emit socket so all clients remove these sales from their local state immediately
    this.appGateway.emitToVentas(SocketEvent.REFRESH_VENTAS, { action: 'bulkDelete', ventaIds: ids, count: result.count });

    const clienteIds = [...new Set(activeVentas.map((v) => v.clienteId).filter(Boolean))] as number[];
    for (const cid of clienteIds) {
      await this.recalcularFidelidadCliente(cid);
    }

    return { count: result.count };
  }

  async emptyTrash() {
    // Find all soft-deleted ventas
    const deletedVentas = await this.prisma.ventas.findMany({
      where: { deletedAt: { not: null } },
      select: { IDventas: true }
    });
    
    const deletedIds = deletedVentas.map(v => v.IDventas);
    
    if (deletedIds.length > 0) {
      // Clean up child items first
      await this.prisma.orderventas.deleteMany({
        where: { IDventas: { in: deletedIds } },
      });
    }

    const result = await this.prisma.ventas.deleteMany({
      where: { deletedAt: { not: null } },
    });

    if (result.count > 0) {
      this.notificationsService.sendNotification(
        'VENTA_TRASH_EMPTY',
        'Papelera Vaciada',
        `Se han eliminado permanentemente ${result.count} pedidos de la papelera.`,
        {}
      );
      // Emit socket so all clients remove trashed sales from their local state immediately
      if (deletedIds.length > 0) {
        this.appGateway.emitToVentas(SocketEvent.REFRESH_VENTAS, { action: 'bulkDelete', ventaIds: deletedIds, count: result.count });
      }
    }

    return { message: 'Papelera vaciada correctamente', count: result.count };
  }

  async despejarVenta(id: string, despejar: boolean = true) {
    const venta = await this.prisma.ventas.findUnique({
      where: { IDventas: id },
    });
    if (!venta) {
      throw new NotFoundException(`Venta con ID ${id} no encontrada`);
    }

    const updated = await this.prisma.ventas.update({
      where: { IDventas: id },
      data: {
        despejadoAt: despejar ? new Date() : null,
      },
      include: {
        ordenVentas: { include: { producto: { include: { categoriaRelacion: true } } } },
        usuarioRelacion: { select: { IDusuarios: true, nombre: true, email: true } },
        facturaElectronica: true,
      },
    });

    this.appGateway.emitToVentas(SocketEvent.REFRESH_VENTAS, { action: 'update', venta: updated });
    return updated;
  }

  async despejarVentasBulk(ids: string[], despejar: boolean = true) {
    if (!ids || ids.length === 0) return { count: 0 };
    const dateVal = despejar ? new Date() : null;
    const result = await this.prisma.ventas.updateMany({
      where: { IDventas: { in: ids } },
      data: { despejadoAt: dateVal },
    });

    this.appGateway.emitToVentas(SocketEvent.REFRESH_VENTAS, { 
      action: 'despejarBulk', 
      ventaIds: ids, 
      despejadoAt: dateVal ? dateVal.toISOString() : null 
    });
    return result;
  }

  async marcarComandaImpresa(id: string) {
    const now = new Date();
    await this.prisma.ventas.update({
      where: { IDventas: id },
      data: { comandaImpresaAt: now },
    });
    await this.prisma.orderventas.updateMany({
      where: { IDventas: id },
      data: { comandaImpresa: true },
    });
    const updated = await this.prisma.ventas.findUnique({
      where: { IDventas: id },
      include: {
        ordenVentas: { include: { producto: { include: { categoriaRelacion: true } } } },
        usuarioRelacion: { select: { IDusuarios: true, nombre: true, email: true } },
        facturaElectronica: true,
      },
    });
    if (updated) {
      this.appGateway.emitToVentas(SocketEvent.REFRESH_VENTAS, { action: 'update', venta: updated });
    }
    return { success: true, timestamp: now };
  }

  async dispararSincronizacionFidelidadExterna(ventaId: string, accion: 'PAGADO' | 'ANULADO') {
    const externalUrl = process.env.FIDELIDAD_EXTERNA_URL;
    if (!externalUrl) return;

    try {
      const venta = await this.prisma.ventas.findUnique({
        where: { IDventas: ventaId },
        include: {
          ordenVentas: true,
          clienteRelacion: true,
        },
      });

      if (!venta) return;

      const esDesechableOEmpaque = (nombre?: string | null, categoria?: string | null) => {
        const text = `${nombre || ''} ${categoria || ''}`.toLowerCase();
        return /tapa|caja|vaso|empaque|desechable|bolsa|envase|cubierto/i.test(text);
      };

      const platosValidos = (venta.ordenVentas || []).filter((item) => {
        const precio = Number(item.precio || item.precioTotal || 0);
        if (precio <= 0) return false;
        if (esDesechableOEmpaque(item.nombre, item.categoria || item.categoriaProducto)) {
          return false;
        }
        return true;
      }).reduce((sum, item) => sum + (Number(item.cantidad) || 1), 0);

      if (accion === 'PAGADO' && platosValidos <= 0) return;

      const cliente = venta.clienteRelacion;
      const cleanCedula = cliente?.cedula ? cliente.cedula.toString() : '';
      const cleanTelefono = cliente?.whatsapp || (venta as any).telefono || '';
      const cleanNombre = cliente?.nombre || venta.cliente || 'Cliente';

      if (!cleanCedula && !cleanTelefono) return;

      const payload = {
        ventaIdExterna: ventaId,
        accion,
        cliente: {
          cedula: cleanCedula || undefined,
          telefono: cleanTelefono || undefined,
          nombre: cleanNombre,
        },
        platosValidos,
        origen: process.env.APP_NAME || 'restaurante_externo',
      };

      const targetEndpoint = externalUrl.replace(/\/+$/, '') + '/api/v1/clientes/fidelidad/sincronizar-compra-externa';
      await axios.post(targetEndpoint, payload, { timeout: 7000 });
      this.logger.log('Sincronizacion fidelidad externa enviada (' + accion + ') venta ' + ventaId);
    } catch (err: any) {
      this.logger.warn('No se pudo sincronizar fidelidad externa para venta ' + ventaId + ': ' + (err?.message || err));
    }
  }

}
