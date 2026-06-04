import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateInventarioDto, UpdateInventarioDto, CreateOrderInventarioDto, InventarioQueryDto, OrderInventarioQueryDto } from './dto/inventario.dto';
import { Prisma } from '@prisma/client';
import { AppGateway } from '../websocket/app.gateway';
import { SocketEvent } from '../websocket/types/socket.types';

@Injectable()
export class InventarioService {
  constructor(
    private prisma: PrismaService,
    private appGateway: AppGateway
  ) {}

  async create(createInventarioDto: CreateInventarioDto) {
    const inventario = await this.prisma.inventario.create({
      data: {
        ...createInventarioDto,
        fechaYHora: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    this.appGateway.emitToInventario(SocketEvent.REFRESH_INVENTARIO, { action: 'create', data: inventario });
    return inventario;
  }

  async findAll(query: InventarioQueryDto) {
    const { page = 1, limit = 20, tipo, buscar } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.InventarioWhereInput = {};

    if (tipo) {
      where.tipo = { contains: tipo, mode: 'insensitive' };
    }

    if (buscar) {
      where.nombre = { contains: buscar, mode: 'insensitive' };
    }

    const [data, total] = await Promise.all([
      this.prisma.inventario.findMany({
        where,
        skip,
        take: limit,
        orderBy: { fechaYHora: 'desc' },
        include: {
          ordenInventario: true,
        },
      }),
      this.prisma.inventario.count({ where }),
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

  async findAllOrdenes(query: OrderInventarioQueryDto) {
    const { page = 1, limit = 50, buscar, tipo, provedor, fechaInicio, fechaFin, categoria } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.OrderinventarioWhereInput = {};

    if (buscar) {
        // Find matching Insumos by name so we can search by their IDs
        const matchingInsumos = await this.prisma.insumos.findMany({
          where: {
            nombre: { contains: buscar, mode: 'insensitive' }
          },
          select: { IDalimentos: true },
          take: 50 // Limit results to drastically reduce DB search latency
        });
        const insumoIds = matchingInsumos.map(i => i.IDalimentos);

      where.OR = [
        { nombreDelAlimento: { contains: buscar, mode: 'insensitive' } },
        { nombreDelAlimento: { in: insumoIds } },
        { observacion: { contains: buscar, mode: 'insensitive' } },
        { provedor: { contains: buscar, mode: 'insensitive' } },
      ];
    }

    if (provedor) {
      where.provedor = { contains: provedor, mode: 'insensitive' };
    }

    if (categoria) {
      where.categoria = { contains: categoria, mode: 'insensitive' };
    }

    if (tipo) {
      where.inventario = {
        tipo: { contains: tipo, mode: 'insensitive' },
      };
    }

    if (fechaInicio || fechaFin) {
      where.fechaYHora = {};
      if (fechaInicio) where.fechaYHora.gte = new Date(fechaInicio);
      if (fechaFin) where.fechaYHora.lte = new Date(fechaFin);
    }

    const [data, total] = await Promise.all([
      this.prisma.orderinventario.findMany({
        where,
        skip,
        take: limit,
        orderBy: [
          { fechaYHora: 'desc' },
          { createdAt: 'desc' }
        ],
        include: {
          inventario: true,
        },
      }),
      this.prisma.orderinventario.count({ where }),
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
    const inventario = await this.prisma.inventario.findUnique({
      where: { IDinventario: id },
      include: {
        ordenInventario: true,
      },
    });

    if (!inventario) {
      throw new NotFoundException(`Inventario con ID ${id} no encontrado`);
    }

    return inventario;
  }

  async update(id: string, updateInventarioDto: UpdateInventarioDto) {
    const updated = await this.prisma.inventario.update({
      where: { IDinventario: id },
      data: updateInventarioDto,
    });
    this.appGateway.emitToInventario(SocketEvent.REFRESH_INVENTARIO, { action: 'update', data: updated });
    return updated;
  }

  async remove(id: string, restoreStock: boolean = true) {
    const inventario = await this.prisma.inventario.findUnique({
      where: { IDinventario: id },
      include: { ordenInventario: true }
    });

    if (!inventario) {
      throw new NotFoundException(`Inventario con ID ${id} no encontrado`);
    }

    if (restoreStock && inventario.ordenInventario && inventario.ordenInventario.length > 0) {
      const isEntrada = inventario.tipo?.toUpperCase().includes('ENTRADA');
      let stockChanged = false;

      for (const item of inventario.ordenInventario) {
        if (item.seCompro?.toLowerCase() === 'si' && item.nombreDelAlimento) {
          const insumo = await this.prisma.insumos.findFirst({
            where: { OR: [{ IDalimentos: item.nombreDelAlimento }, { nombre: item.nombreDelAlimento }] },
          });

          if (insumo) {
            let nuevaCantidadHist = insumo.cantidad || 0;
            let nuevoDisponible = Number(insumo.disponible) || 0;

            if (isEntrada) {
              nuevaCantidadHist -= (item.cantidad || 0);
              nuevoDisponible -= (item.cantidad || 0);
              if (nuevaCantidadHist < 0) nuevaCantidadHist = 0;
            } else {
              nuevoDisponible += (item.cantidad || 0);
            }

            await this.prisma.insumos.update({
              where: { IDalimentos: insumo.IDalimentos },
              data: {
                cantidad: nuevaCantidadHist,
                disponible: nuevoDisponible
              }
            });
            stockChanged = true;
          }
        }
      }

      if (stockChanged) {
        this.appGateway.emitToInsumos(SocketEvent.REFRESH_INSUMOS, { action: 'update_stock_batch' });
      }
    }

    // Asegurarse de eliminar los items hijos primero
    await this.prisma.orderinventario.deleteMany({
      where: { IDinventario: id }
    });

    const deleted = await this.prisma.inventario.delete({
      where: { IDinventario: id },
    });
    this.appGateway.emitToInventario(SocketEvent.REFRESH_INVENTARIO, { action: 'delete', id });
    return deleted;
  }

  async agregarItem(createOrderDto: CreateOrderInventarioDto) {
    const { nombreDelAlimento, cantidad, precioActual } = createOrderDto;

    let insumoActualizado: any = null;

    // Obtener el inventario padre para saber si es ENTRADA o SALIDA
    const inventarioPadre = await this.prisma.inventario.findUnique({
      where: { IDinventario: createOrderDto.IDinventario }
    });
    const isEntrada = inventarioPadre?.tipo?.toUpperCase().includes('ENTRADA');

    if (nombreDelAlimento && cantidad && cantidad > 0) {
      const insumo = await this.prisma.insumos.findFirst({
        where: {
          OR: [
            { IDalimentos: nombreDelAlimento },
            { nombre: nombreDelAlimento },
          ],
        },
      });

      if (insumo) {
        const disponibleActual = Number(insumo.disponible) || 0;
        const cantidadHist = insumo.cantidad || 0;

        // SOLO descontar si es SALIDA
        if (!isEntrada) {
          await this.prisma.insumos.update({
            where: { IDalimentos: insumo.IDalimentos },
            data: {
              disponible: disponibleActual - cantidad,
              cantidad: cantidadHist,
            },
          });
        }

        insumoActualizado = await this.prisma.insumos.findUnique({
          where: { IDalimentos: insumo.IDalimentos }
        });

        if (!isEntrada) {
          this.appGateway.emitToInsumos(SocketEvent.REFRESH_INSUMOS, { action: 'update_stock' });
        }
      }
    }

    const item = await this.prisma.orderinventario.create({
      data: {
        ...createOrderDto,
        fechaYHora: new Date(),
        disponible: 'si',
        seCompro: 'no',
        cantInsumos: insumoActualizado ? Number(insumoActualizado.disponible) : 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    this.appGateway.emitToInventario(SocketEvent.REFRESH_INVENTARIO, { action: 'agregarItem', data: item });
    return item;
  }

  async updateItem(id: string, updateOrderDto: any) {
    const item = await this.prisma.orderinventario.findUnique({
      where: { IDorderinventario: id },
    });

    if (!item) {
      throw new NotFoundException(`Item con ID ${id} no encontrado`);
    }

    const dataToUpdate: any = {};

    if (updateOrderDto.cantidad !== undefined) {
      dataToUpdate.cantidad = updateOrderDto.cantidad;
    }
    if (updateOrderDto.precio !== undefined) {
      dataToUpdate.precio = updateOrderDto.precio;
      dataToUpdate.precioActual = updateOrderDto.precio;
    } else if (updateOrderDto.precioActual !== undefined) {
      dataToUpdate.precioActual = updateOrderDto.precioActual;
      dataToUpdate.precio = updateOrderDto.precioActual;
    }

    // Recalcular subtotal
    const cant = dataToUpdate.cantidad !== undefined ? dataToUpdate.cantidad : (item.cantidad || 0);
    const prec = dataToUpdate.precioActual !== undefined ? dataToUpdate.precioActual : (item.precioActual || item.precio || 0);
    dataToUpdate.subtotal = cant * Number(prec);

    const updated = await this.prisma.orderinventario.update({
      where: { IDorderinventario: id },
      data: dataToUpdate,
    });

    if (item.IDinventario) {
      const inventario = await this.prisma.inventario.findUnique({
        where: { IDinventario: item.IDinventario },
        include: { ordenInventario: true }
      });
      if (inventario && inventario.tipo?.toUpperCase().includes('ENTRADA')) {
        const nuevoTotal = inventario.ordenInventario.reduce((sum, o) => {
          return sum + (Number(o.subtotal) || ((Number(o.precioActual) || Number(o.precio) || 0) * (Number(o.cantidad) || 0)));
        }, 0);
        await this.prisma.inventario.update({
          where: { IDinventario: item.IDinventario },
          data: { total: nuevoTotal }
        });
      }
    }

    this.appGateway.emitToInventario(SocketEvent.REFRESH_INVENTARIO, { action: 'updateItem', id });
    return updated;
  }

  async eliminarItem(id: string, restoreStock: boolean = true) {
    const item = await this.prisma.orderinventario.findUnique({
      where: { IDorderinventario: id },
      include: { inventario: true }
    });

    if (!item) {
      throw new NotFoundException(`Item con ID ${id} no encontrado`);
    }

    const isEntrada = item.inventario?.tipo?.toUpperCase().includes('ENTRADA');

    if (item.nombreDelAlimento && item.cantidad && item.cantidad > 0) {
      const insumo = await this.prisma.insumos.findFirst({
        where: { OR: [{ IDalimentos: item.nombreDelAlimento }, { nombre: item.nombreDelAlimento }] },
      });

      if (insumo) {
        const cantidadHist = insumo.cantidad || 0;
        const disponibleActual = Number(insumo.disponible) || 0;

        if (restoreStock) {
          if (isEntrada) {
            if (item.seCompro?.toLowerCase() === 'si') {
              await this.prisma.insumos.update({
                where: { IDalimentos: insumo.IDalimentos },
                data: {
                  cantidad: Math.max(0, cantidadHist - (item.cantidad || 0)),
                  disponible: disponibleActual - (item.cantidad || 0),
                },
              });
            }
          } else {
            await this.prisma.insumos.update({
              where: { IDalimentos: insumo.IDalimentos },
              data: {
                cantidad: cantidadHist,
                disponible: disponibleActual + (item.cantidad || 0),
              },
            });
          }
        }
      }
    }

    const deleted = await this.prisma.orderinventario.delete({
      where: { IDorderinventario: id },
    });

    if (item.IDinventario) {
      const inventario = await this.prisma.inventario.findUnique({
        where: { IDinventario: item.IDinventario },
        include: { ordenInventario: true }
      });
      if (inventario && inventario.tipo?.toUpperCase().includes('ENTRADA')) {
        const nuevoTotal = inventario.ordenInventario.reduce((sum, o) => {
          return sum + (Number(o.subtotal) || ((Number(o.precioActual) || Number(o.precio) || 0) * (Number(o.cantidad) || 0)));
        }, 0);
        await this.prisma.inventario.update({
          where: { IDinventario: item.IDinventario },
          data: { total: nuevoTotal }
        });
      }
    }

    this.appGateway.emitToInventario(SocketEvent.REFRESH_INVENTARIO, { action: 'eliminarItem', id });
    if (item.nombreDelAlimento) {
      this.appGateway.emitToInsumos(SocketEvent.REFRESH_INSUMOS, { action: 'update_stock' });
    }
    return deleted;
  }

  async marcarComprado(id: string) {
    const item = await this.prisma.orderinventario.findUnique({
      where: { IDorderinventario: id },
      include: { inventario: true }
    });

    if (!item) {
      throw new NotFoundException(`Item con ID ${id} no encontrado`);
    }

    const newStatus = item.seCompro?.toLowerCase() === 'si' ? 'no' : 'si';
    const isEntrada = item.inventario?.tipo?.toUpperCase().includes('ENTRADA');

    await this.prisma.orderinventario.update({
      where: { IDorderinventario: id },
      data: { 
        seCompro: newStatus === 'si' ? 'Si' : 'No',
        agregarAInsumos: newStatus === 'si' ? 'Si' : 'No'
      },
    });

    if (item.nombreDelAlimento) {
      const insumo = await this.prisma.insumos.findFirst({
        where: {
          OR: [
            { IDalimentos: item.nombreDelAlimento },
            { nombre: item.nombreDelAlimento },
          ],
        },
      });

      if (insumo) {
        let nuevaCantidadHist = insumo.cantidad || 0;
        let nuevoDisponible = Number(insumo.disponible) || 0;
        
        if (isEntrada) {
          if (newStatus === 'si') {
            nuevaCantidadHist += (item.cantidad || 0);
            nuevoDisponible += (item.cantidad || 0);
          } else {
            nuevaCantidadHist -= (item.cantidad || 0);
            nuevoDisponible -= (item.cantidad || 0);
            if (nuevaCantidadHist < 0) nuevaCantidadHist = 0;
          }
        } else {
          // Es una salida (Salida)
          if (newStatus === 'si') {
            nuevoDisponible -= (item.cantidad || 0);
          } else {
            nuevoDisponible += (item.cantidad || 0);
          }
        }

        await this.prisma.insumos.update({
          where: { IDalimentos: insumo.IDalimentos },
          data: { 
            cantidad: nuevaCantidadHist,
            disponible: nuevoDisponible,
            ...(newStatus === 'si' && isEntrada && item.precioActual ? { precio: item.precioActual } : {})
          },
        });

        // Guardamos en el item del inventario el stock disponible actual que quedó en ese momento
        await this.prisma.orderinventario.update({
          where: { IDorderinventario: id },
          data: { cantInsumos: nuevoDisponible }
        });

        // Emitir cambio de insumo para reflejar en el inventario real-time
        this.appGateway.emitToInsumos(SocketEvent.REFRESH_INSUMOS, { action: 'update_stock' });
      }
    }

    const updatedItem = await this.prisma.orderinventario.findUnique({
      where: { IDorderinventario: id },
    });
    this.appGateway.emitToInventario(SocketEvent.REFRESH_INVENTARIO, { action: 'marcarComprado', data: updatedItem });
    return updatedItem;
  }

  async marcarVariosComprado(ids: string[]) {
    const resultados = [];
    for (const id of ids) {
      try {
        const result = await this.marcarComprado(id);
        resultados.push({ id, success: true, data: result });
      } catch (error) {
        resultados.push({ id, success: false, error: error.message });
      }
    }
    return resultados;
  }

  async getInventarioBajo() {
    const items = await this.prisma.orderinventario.findMany({
      where: {
        disponible: 'si',
        seCompro: 'no',
      },
    });

    return items.filter((item) => (item.cantidad ?? 0) < 10);
  }

  /**
   * Calcula el stock teórico de un insumo basándose en el historial completo
   * de orderinventario (entradas marcadas como compradas - salidas registradas).
   * Útil para verificar el stock correcto después de un ajuste manual o pérdida de datos.
   * NO modifica ningún valor en la base de datos.
   */
  async calcularStockHistoricoInsumo(insumoId: string) {
    const insumo = await this.prisma.insumos.findUnique({
      where: { IDalimentos: insumoId },
    });

    if (!insumo) {
      throw new Error(`Insumo con ID ${insumoId} no encontrado`);
    }

    // Buscar todas las órdenes relacionadas por ID o nombre del insumo
    const ordenes = await this.prisma.orderinventario.findMany({
      where: {
        OR: [
          { nombreDelAlimento: insumoId },
          { nombreDelAlimento: insumo.nombre },
        ],
      },
      include: { inventario: true },
      orderBy: { fechaYHora: 'asc' },
    });

    let totalEntradas = 0;
    let totalSalidas = 0;
    const movimientos: Array<{
      fecha: Date | null;
      tipo: string;
      cantidad: number;
      observacion: string | null;
    }> = [];

    for (const orden of ordenes) {
      if (!orden.cantidad || orden.cantidad <= 0) continue;

      const isEntrada = orden.inventario?.tipo?.toUpperCase().includes('ENTRADA');

      if (isEntrada) {
        if (orden.seCompro?.toLowerCase() === 'si') {
          totalEntradas += orden.cantidad;
          movimientos.push({
            fecha: orden.fechaYHora,
            tipo: 'entrada',
            cantidad: orden.cantidad,
            observacion: orden.observacion || 'Entrada de inventario',
          });
        }
        // Entradas no marcadas como compradas no cuentan
      } else {
        totalSalidas += orden.cantidad;
        movimientos.push({
          fecha: orden.fechaYHora,
          tipo: 'salida',
          cantidad: orden.cantidad,
          observacion: orden.observacion || 'Salida de inventario',
        });
      }
    }

    const stockCalculado = Math.max(0, totalEntradas - totalSalidas);
    const stockActual = Number(insumo.disponible) || 0;
    const diferencia = stockActual - stockCalculado;

    return {
      success: true,
      data: {
        insumoId: insumo.IDalimentos,
        nombre: insumo.nombre,
        stockActual,
        stockCalculado,
        diferencia,
        alerta: Math.abs(diferencia) > 0,
        resumen: {
          totalEntradas,
          totalSalidas,
          totalMovimientos: movimientos.length,
        },
        movimientos,
      },
    };
  }

  async recalcularStockInsumos() {
    // IMPORTANTE: Esta funcion SOLO recalcula totales de inventario.
    // NO modifica el stock de insumos para evitar perdida de datos.
    // El stock de insumos se gestiona en tiempo real con cada operacion individual.
    const inventarioTotalesMap = new Map<string, number>();

    const ordenes = await this.prisma.orderinventario.findMany({
      include: { inventario: true }
    });

    for (const orden of ordenes) {
      if (!orden.IDinventario || !orden.cantidad || orden.cantidad <= 0) continue;

      const isEntrada = orden.inventario?.tipo?.toUpperCase().includes('ENTRADA');
      if (isEntrada) {
        const ordenTotal = Number(orden.subtotal) || ((Number(orden.precioActual) || 0) * Number(orden.cantidad));
        inventarioTotalesMap.set(orden.IDinventario, (inventarioTotalesMap.get(orden.IDinventario) || 0) + ordenTotal);
      }
    }

    for (const [invId, nuevoTotal] of inventarioTotalesMap) {
      await this.prisma.inventario.update({
        where: { IDinventario: invId },
        data: { total: nuevoTotal }
      }).catch(() => {});
    }

    this.appGateway.emitToInventario(SocketEvent.REFRESH_INVENTARIO, { action: 'recalcular_total' });

    return {
      success: true,
      message: `Totales de inventario actualizados para ${inventarioTotalesMap.size} registros`,
    };
  }
}

