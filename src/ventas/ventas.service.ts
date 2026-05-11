import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateVentaDto, CreateOrderVentaDto, CreateVentaCompletaDto, VentaQueryDto } from './dto/venta.dto';
import { Prisma } from '@prisma/client';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class VentasService {
  constructor(
    private prisma: PrismaService,
    private notificationsService: NotificationsService
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

  async create(createVentaDto: CreateVentaDto) {
    const pedido = await this.generatePedidoNumber(createVentaDto.mesa, undefined);
    return this.prisma.ventas.create({
      data: {
        ...createVentaDto,
        mesa: createVentaDto.mesa === 'V.R' ? null : createVentaDto.mesa,
        pedido,
        fechaYHora: new Date(),
        fecha: new Date(),
        hora: new Date().toTimeString().split(' ')[0],
        estado: createVentaDto.estado || 'iniciado',
        registroDeTiempo: this.generateTiempoLog(createVentaDto.estado || 'iniciado', createVentaDto.cartStartTime),
      } as Prisma.VentasCreateInput,
    });
  }

  async generatePedidoNumber(mesaId: string | null | undefined, usuarioNombre: string | null | undefined): Promise<string> {
    const now = new Date();
    const hora = now.getHours();

    const shiftStart = new Date(now);
    if (hora < 15) {
      shiftStart.setDate(shiftStart.getDate() - 1);
    }
    shiftStart.setHours(15, 0, 0, 0);

    const ventasDelTurno = await this.prisma.ventas.findMany({
      where: {
        fechaYHora: {
          gte: shiftStart,
        },
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

  async createVentaCompleta(createVentaCompletaDto: CreateVentaCompletaDto, usuarioId: string) {
    const { venta, productos } = createVentaCompletaDto;

    const usuario = await this.prisma.usuarios.findUnique({
      where: { IDusuarios: usuarioId },
      select: { nombre: true },
    });

    const pedidoGenerado = await this.generatePedidoNumber(
      venta.mesa && venta.mesa !== 'V.R' ? venta.mesa : null,
      usuario?.nombre
    );

    const ventaData = {
      mesa: venta.mesa && venta.mesa !== 'V.R' ? venta.mesa : null, // Fix: Use 'V.R' logic for the DB relation
      medioDePago: venta.medioDePago,
      efectivoRecibido: venta.efectivoRecibido,
      devueltas: venta.devueltas,
      banco: venta.medioDePago === 'EFECTIVO' ? null : venta.banco, // Fix: If EFECTIVO, Banco is null
      totalInput: venta.totalInput,
      descuento: venta.descuento,
      porcentajeDeDescuento: venta.porcentajeDeDescuento,
    };

    // Fix: Local timezone adjustment for 'fecha' field
    const fechaVenta = new Date();
    const offset = fechaVenta.getTimezoneOffset() * 60000;
    const localDate = new Date(fechaVenta.getTime() - offset);

    const ventaCreada = await this.prisma.ventas.create({
      data: {
        ...ventaData,
        mesa: venta.mesa === 'V.R' ? null : venta.mesa,
        pedido: pedidoGenerado,
        estado: venta.estado || 'EN_EL_CARRITO',
        usuario: usuarioId,
        fechaYHora: new Date(),
        fecha: localDate, // Use local date
        hora: new Date().toTimeString().split(' ')[0],
        registroDeTiempo: this.generateTiempoLog(venta.estado || 'EN_EL_CARRITO', (venta as any).cartStartTime),
      } as Prisma.VentasCreateInput,
    });

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

        // Create the date adjusting for local time safely so that "fecha" (which is Date type) 
        // doesn't jump forward if we are past 7PM UTC-5
        const fechaVenta = new Date();
        const offset = fechaVenta.getTimezoneOffset() * 60000;
        const localDate = new Date(fechaVenta.getTime() - offset);

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
            fecha: localDate, // Fix: Use local date to avoid shifting to next day
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

    return {
      ...ventaCreada,
      ordenVentas: ordenesVentas,
    };
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

    return this.prisma.ventas.update({
      where: { IDventas: id },
      data: { 
        estado,
        registroDeTiempo: nuevoRegistro
      },
    });
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

    return result;
  }

  async removeBulk(ids: string[], usuarioId: string, reason?: string) {
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

    return { count: result.count };
  }

  async restore(id: string) {
    const venta = await this.prisma.ventas.findFirst({
      where: { IDventas: id, deletedAt: { not: null } },
    });

    if (!venta) {
      throw new NotFoundException(`Venta eliminada con ID ${id} no encontrada`);
    }

    return this.prisma.ventas.update({
      where: { IDventas: id },
      data: {
        deletedAt: null,
        deletedBy: null,
        deleteReason: null,
      },
    });
  }

  async hardDelete(id: string) {
    const venta = await this.prisma.ventas.findFirst({
      where: { IDventas: id },
    });

    if (!venta) {
      throw new NotFoundException(`Venta con ID ${id} no encontrada`);
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
