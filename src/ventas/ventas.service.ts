import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateVentaDto, CreateOrderVentaDto, CreateVentaCompletaDto, VentaQueryDto } from './dto/venta.dto';
import { Prisma } from '@prisma/client';
import { NotificationsService } from '../notifications/notifications.service';
import { InsumosService } from '../insumos/insumos.service';
import { AppGateway } from '../websocket/app.gateway';
import { SocketEvent } from '../websocket/types/socket.types';

@Injectable()
export class VentasService {
  constructor(
    private prisma: PrismaService,
    private notificationsService: NotificationsService,
    private insumosService: InsumosService,
    private appGateway: AppGateway,
  ) {}

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
      const inicioTime = new Date(cartStartTime);
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
      const cantidadVendida = producto.cantidad || 0;
      const nombreProd = producto.nombre || producto.nombreProducto || 'Producto';

      if (!productoId || cantidadVendida <= 0) continue;

      // Buscar la receta de este producto
      const recetas = await this.prisma.recetainsumos.findMany({
        where: { IDproductos: productoId },
        include: { insumoRelacion: true },
      });

      for (const receta of recetas) {
        const insumo = receta.insumoRelacion;
        const descontarFlag = insumo?.descontarCantDeVentas?.toLowerCase() === 'si';
        
        if (insumo && descontarFlag && receta.cantidad) {
          const cantidadTotal = cantidadVendida * receta.cantidad;
          if (cantidadTotal > 0) {
            try {
              await this.insumosService.movimientoStock(
                insumo.IDalimentos,
                tipo,
                cantidadTotal,
                `${motivoPrefijo}: ${nombreProd}`,
                undefined,
                true // allowNegative
              );
            } catch (error) {
              console.error(`Error aplicando descuento de receta para insumo ${insumo.nombre}:`, error);
            }
          }
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

    // Buscar configuración dinámica
    let config = await this.prisma.configuracionNegocio.findUnique({ where: { id: 1 } });
    if (!config) config = { id: 1, horaCorteDia: '00:00', updatedAt: new Date() };
    
    const [corteHours, corteMinutes] = config.horaCorteDia.split(':').map(Number);

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

  async create(createVentaDto: CreateVentaDto & { fechaContableManual?: string }) {
    console.log('[DEBUG create] createVentaDto.mesa:', createVentaDto.mesa);
    console.log('[DEBUG create] createVentaDto.clienteId:', createVentaDto.clienteId);
    console.log('[DEBUG create] Full DTO:', JSON.stringify(createVentaDto));
    
    const now = new Date();
    const fechaContable = await this.getFechaContable(now, createVentaDto.fechaContableManual);
    const pedido = await this.generatePedidoNumber(createVentaDto.mesa, undefined, fechaContable);

    const ventaData: any = {
      ...createVentaDto,
      fechaContableManual: undefined,
      mesa: createVentaDto.mesa === 'V.R' ? null : createVentaDto.mesa,
      pedido,
      fechaYHora: now,
      fecha: fechaContable,
      hora: now.toTimeString().split(' ')[0],
      estado: createVentaDto.estado || 'iniciado',
      registroDeTiempo: this.generateTiempoLog(createVentaDto.estado || 'iniciado', createVentaDto.cartStartTime),
    };

    console.log('[DEBUG create] ventaData.mesa:', ventaData.mesa);
    console.log('[DEBUG create] ventaData.clienteId:', ventaData.clienteId);

    const venta = await this.prisma.ventas.create({
      data: ventaData,
    });

    this.appGateway.emitToVentas(SocketEvent.REFRESH_VENTAS, { action: 'create', venta });

    return venta;
  }

  async generatePedidoNumber(mesaId: string | null | undefined, usuarioNombre: string | null | undefined, providedFechaContable?: Date): Promise<string> {
    const fechaContable = providedFechaContable || await this.getFechaContable(new Date());

    const ventasDelTurno = await this.prisma.ventas.findMany({
      where: {
        fecha: fechaContable,
      },
      select: {
        pedido: true,
      },
    });

    let maxConsecutivo = 0;
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

    const siguienteNumero = maxConsecutivo + 1;
    const numeroConsecutivo = siguienteNumero.toString().padStart(3, '0');

    let mesaStr = 'V.R';
    if (mesaId && mesaId !== 'V.R') {
      try {
        const mesaObj = await this.prisma.mesas.findUnique({
          where: { IdMesas: mesaId },
        });
        if (mesaObj && mesaObj.nombre) {
          mesaStr = mesaObj.nombre;
        }
      } catch (error) {
        // mesa not found, keep V.R
      }
    }

    const inicial = usuarioNombre ? usuarioNombre.charAt(0).toUpperCase() : 'X';

    return `${mesaStr}-${inicial}-${numeroConsecutivo}`;
  }

  private async actualizarComprasCliente(prisma: any, clienteId: number, ventaId: string, productos: any[]) {
    // Calcular cantidad total de productos en esta venta
    const cantidadVenta = productos.reduce((total, p) => total + (p.cantidad || 1), 0);

    const cliente = await prisma.clientes.findUnique({
      where: { IDcliente: clienteId }
    });

    if (cliente) {
      // Intentamos extraer el valor actual de 'compras' como número (AppSheet guardaba enteros como string)
      let comprasTotales = parseInt(cliente.compras || '0', 10);
      if (isNaN(comprasTotales)) comprasTotales = 0; // Por si acaso había CSV de IDs, lo reseteamos a 0 o manejamos diferente

      comprasTotales += cantidadVenta;

      // --- Lógica del contador de fidelidad (ciclo 1-10) ---
      // Reglas:
      // 1. El contador suma los productos comprados en esta venta.
      // 2. El contador NUNCA supera 10 dentro de una misma compra (cap).
      // 3. Si el contador YA estaba en 10 al iniciar esta compra, se reinicia el ciclo:
      //    el nuevo contador empieza desde 0 y suma los productos de esta compra (cap 10).
      const contadorActual = cliente.contador || 0;
      let nuevoContador: number;

      if (contadorActual >= 10) {
        // El ciclo anterior se completó → iniciar nuevo ciclo con los productos de esta compra
        nuevoContador = Math.min(cantidadVenta, 10);
      } else {
        // Seguir acumulando en el ciclo actual, sin pasar de 10
        nuevoContador = Math.min(contadorActual + cantidadVenta, 10);
      }

      await prisma.clientes.update({
        where: { IDcliente: clienteId },
        data: {
          contador: nuevoContador,
          compras: comprasTotales.toString(), // Guardamos el entero total en formato string para retrocompatibilidad
          fecha_y_hora_actualizacion: new Date()
        }
      });
    }
  }

  async createVentaCompleta(createVentaCompletaDto: CreateVentaCompletaDto & { fechaContableManual?: string }, usuarioId: string) {
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

    const ventaData = {
      mesa: venta.mesa === 'V.R' ? null : (venta.mesa || null),
      medioDePago: venta.medioDePago,
      efectivoRecibido: venta.efectivoRecibido,
      devueltas: venta.devueltas,
      banco: venta.medioDePago === 'EFECTIVO' ? null : venta.banco,
      totalInput: venta.totalInput,
      descuento: venta.descuento,
      porcentajeDeDescuento: venta.porcentajeDeDescuento,
    };

    const ventaCreada = await this.prisma.ventas.create({
      data: {
        ...ventaData,
        pedido: pedidoGenerado,
        estado: venta.estado || 'EN_EL_CARRITO',
        usuario: usuarioId,
        fechaYHora: fechaVenta,
        fecha: fechaContable,
        hora: fechaVenta.toTimeString().split(' ')[0],
        registroDeTiempo: this.generateTiempoLog(venta.estado || 'EN_EL_CARRITO', (venta as any).cartStartTime),
        clienteId: venta.clienteId || null
      } as Prisma.VentasUncheckedCreateInput,
    });

    // Si hay un cliente asociado, actualizar sus compras y contador
    if (venta.clienteId) {
      await this.actualizarComprasCliente(this.prisma, venta.clienteId, ventaCreada.IDventas, productos);
    }

    const ordenesVentas = await Promise.all(
      productos.map(async (producto) => {
        let nombreProducto: string | undefined | null = producto.nombre;
        let categoriaProducto: string | undefined | null = producto.categoria;

        if (producto.productoId) {
          const productoData = await this.prisma.productos.findUnique({
            where: { IDproductos: producto.productoId },
          });
          if (productoData) {
            nombreProducto = productoData.nombre || undefined;
            categoriaProducto = productoData.categoriaNombre || productoData.categoria || undefined;
          }
        }

        // Apply Jornada Comercial to Orderventas
        const orderFechaContable = fechaContable;

        return this.prisma.orderventas.create({
          data: {
            ...producto,
            nombre: nombreProducto,
            categoria: categoriaProducto,
            nombreProducto,
            categoriaProducto,
            imagenUrl: producto.imagenUrl,
            IDventas: ventaCreada.IDventas,
            usuarioId,
            fecha: orderFechaContable, // Use accounting date
          } as Prisma.OrderventasCreateInput,
        });
      }),
    );

    this.notificationsService.sendNotification(
      'VENTA_CREATED',
      'Nueva Venta Creada',
      `Se ha creado el pedido ${pedidoGenerado} por $${ventaData.totalInput || 0}`,
      { ventaId: ventaCreada.IDventas }
    );

    // DEDUCCIÓN DE INVENTARIO
    // Si la venta está completada/pagada (o se asume que al crearse ya afecta inventario)
    // Descontar los insumos según la receta
    await this.applyRecipeDeductions(productos, 'salida', 'Descuento por venta');

    return {
      ...ventaCreada,
      ordenVentas: ordenesVentas,
    };
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

    const ventaData = {
      mesa: venta.mesa === 'V.R' ? null : (venta.mesa || null),
      medioDePago: venta.medioDePago,
      efectivoRecibido: venta.efectivoRecibido,
      devueltas: venta.devueltas,
      banco: venta.medioDePago === 'EFECTIVO' ? null : venta.banco,
      totalInput: venta.totalInput,
      descuento: venta.descuento,
      porcentajeDeDescuento: venta.porcentajeDeDescuento,
      estado: venta.estado || ventaExistente.estado,
      fecha: fechaContable,
      clienteId: venta.clienteId || null
    };

    // Update Venta
    const ventaActualizada = await this.prisma.ventas.update({
      where: { IDventas: id },
      data: ventaData as Prisma.VentasUncheckedUpdateInput,
    });

    // Replace all Orderventas
    const oldOrderventas = await this.prisma.orderventas.findMany({
      where: { IDventas: id },
    });

    // REVERSO DE INVENTARIO
    // Devolvemos el stock de los productos viejos
    await this.applyRecipeDeductions(oldOrderventas, 'entrada', 'Reverso por edición de venta');

    await this.prisma.orderventas.deleteMany({
      where: { IDventas: id },
    });

    if (productos && productos.length > 0) {
      await Promise.all(
        productos.map(async (producto) => {
          const productoData = await this.prisma.productos.findFirst({
            where: { IDproductos: producto.productoId },
            select: { nombre: true, categoria: true, categoriaNombre: true },
          });

          let nombreProducto = producto.nombre;
          let categoriaProducto = producto.categoria;

          if (productoData) {
            if (!nombreProducto || nombreProducto.trim() === '') {
              nombreProducto = productoData.nombre;
            }
            if (!categoriaProducto || categoriaProducto.trim() === '') {
              categoriaProducto = productoData.categoriaNombre || productoData.categoria || undefined;
            }
          }

          return this.prisma.orderventas.create({
            data: {
              ...producto,
              nombre: nombreProducto,
              categoria: categoriaProducto,
              nombreProducto,
              categoriaProducto,
              imagenUrl: producto.imagenUrl,
              IDventas: ventaActualizada.IDventas,
              usuarioId,
              fecha: fechaContable,
            } as Prisma.OrderventasCreateInput,
          });
        }),
      );

      // APLICACIÓN DE NUEVO INVENTARIO
      await this.applyRecipeDeductions(productos, 'salida', 'Descuento por venta editada');
    }

    return this.prisma.ventas.findUnique({
      where: { IDventas: id },
      include: { ordenVentas: true },
    });
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
      categoriaProducto
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
      where.OR = [
        { pedido: { contains: search, mode: 'insensitive' } },
        { cliente: { contains: search, mode: 'insensitive' } },
        // Also allow searching by order products names if they match
        { ordenVentas: { some: { nombre: { contains: search, mode: 'insensitive' } } } }
      ];
    }

    if (estado) {
      where.estado = estado;
    }

    if (usuario) {
      where.usuario = usuario;
    }

    if (mesa) {
      where.mesa = mesa;
    }

    if (medioDePago) {
      where.medioDePago = medioDePago;
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

    if (productoId || categoriaProducto) {
      where.ordenVentas = {
        some: {
          ...(productoId ? { productoId } : {}),
          ...(categoriaProducto ? { categoria: categoriaProducto } : {})
        }
      };
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
                select: { IDproductos: true, nombre: true, categoriaNombre: true, categoria: true, imagenUrl: true, image: true },
              },
            },
          },
          usuarioRelacion: {
            select: { IDusuarios: true, nombre: true, email: true },
          },
          clienteRelacion: {
            select: { IDcliente: true, nombre: true, cedula: true, whatsapp: true, compras: true, contador: true }
          }
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
            producto: true,
          },
        },
        usuarioRelacion: true,
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

    const updated = await this.prisma.ventas.update({
      where: { IDventas: id },
      data: {
        estado,
        registroDeTiempo: nuevoRegistro
      },
    });

    this.appGateway.emitToVentas(SocketEvent.REFRESH_VENTAS, { action: 'updateEstado', venta: updated });

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

    const inicio = new Date(log[0].fecha_hora);
    const fin = log.length > 1 ? new Date(log[log.length - 1].fecha_hora) : new Date();
    
    const diffMs = fin.getTime() - inicio.getTime();

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

    const nuevoRegistro = this.appendTiempoLog(venta.registroDeTiempo, updateData.estado || 'PAGADO');

    return this.prisma.ventas.update({
      where: { IDventas: id },
      data: {
        estado: updateData.estado || 'PAGADO',
        medioDePago: updateData.medioDePago,
        efectivoRecibido: updateData.efectivoRecibido,
        devueltas: updateData.devueltas,
        banco: updateData.banco,
        totalInput: updateData.totalInput,
        descuento: updateData.descuento,
        porcentajeDeDescuento: updateData.porcentajeDeDescuento,
        registroDeTiempo: nuevoRegistro,
      },
    });
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
            categoria: producto.categoria,
            categoriaProducto: producto.categoriaProducto || producto.categoria,
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
      },
      orderBy: { fechaYHora: 'desc' },
    });
  }

  async findVentasHoy() {
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);

    return this.prisma.ventas.findMany({
      where: {
        fechaYHora: { gte: hoy },
        estado: 'PAGADO',
        deletedAt: null,
      },
      include: {
        ordenVentas: true,
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
    await this.applyRecipeDeductions(oldOrderventas, 'entrada', 'Reverso por anulación de venta');

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

    return result;
  }

  async removeBulk(ids: string[], usuarioId: string, reason?: string) {
    // REVERSO DE INVENTARIO PARA TODAS LAS VENTAS
    const oldOrderventas = await this.prisma.orderventas.findMany({
      where: { IDventas: { in: ids } },
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

    return restored;
  }

  async hardDelete(id: string) {
    const venta = await this.prisma.ventas.findFirst({
      where: { IDventas: id },
    });

    if (!venta) {
      throw new NotFoundException(`Venta con ID ${id} no encontrada`);
    }

    if (venta.deletedAt === null) {
      const oldOrderventas = await this.prisma.orderventas.findMany({
        where: { IDventas: id },
      });
      await this.applyRecipeDeductions(oldOrderventas, 'entrada', 'Reverso por hard-delete');
    }

    // Intelligently clean up child items first just in case
    await this.prisma.orderventas.deleteMany({
      where: { IDventas: id },
    });

    return this.prisma.ventas.delete({
      where: { IDventas: id },
    });
  }

  async hardDeleteBulk(ids: string[]) {
    const activeVentas = await this.prisma.ventas.findMany({
      where: { IDventas: { in: ids }, deletedAt: null },
    });

    if (activeVentas.length > 0) {
      const activeIds = activeVentas.map(v => v.IDventas);
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
    }

    return { message: 'Papelera vaciada correctamente', count: result.count };
  }
}
