import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateAperturaCierreCajaDto, UpdateCierreCajaDto, CajaQueryDto } from './dto/caja.dto';
import { Prisma } from '@prisma/client';
import { AppGateway } from '../websocket/app.gateway';
import { SocketEvent } from '../websocket/types/socket.types';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class CajaService {
  constructor(
    private prisma: PrismaService,
    private appGateway: AppGateway,
    private notificationsService: NotificationsService,
  ) {}

  async abrirCaja(createCajaDto: CreateAperturaCierreCajaDto) {
    const { insumos, ...cajaData } = createCajaDto;

    // Whitelist fields for aperturaCierreCaja creation
    const allowedFields = [
      'nombre', 'apertura', 'fechaDeApertura', 'horaDeApertura',
      'efectivoDeApertura', 'fechaDeCierre', 'horaDeCierre',
      'efectivoDeCierre', 'resumen', 'pdf', 'pdfcount', 'observaciones',
      'cierre', 'total12Onz', 'total24Onz', 'productos', 'tipoDeVaso',
      'cantAAgregar', 'plataGuardada', 'cuadroCaja', 'valorFaltante',
      'valorExcedente', 'transferenciasContadas', 'contador', 'contador2'
    ];
    const parsedData: any = {};
    for (const key of allowedFields) {
      if (key in cajaData && (cajaData as any)[key] !== undefined) {
        let value = (cajaData as any)[key];
        if ((key === 'fechaDeApertura' || key === 'fechaDeCierre') && typeof value === 'string') {
          value = new Date(value + 'T00:00:00.000Z');
        }
        parsedData[key] = value;
      }
    }

    return this.prisma.$transaction(async (tx) => {
      const caja = await tx.aperturaCierreCaja.create({
        data: {
          ...parsedData,
          fechaDeApertura: new Date(),
          horaDeApertura: new Date().toTimeString().split(' ')[0],
          cierre: 'abierta',
        },
      });

      if (insumos && insumos.length > 0) {
        for (const insumo of insumos) {
          await tx.aperturaCierreInsumos.create({
            data: {
              IDcaja: caja.IDcaja,
              nombreInsumo: insumo.nombreInsumo,
              cantApertura: insumo.cantApertura,
              unidadDeMedida: insumo.unidadDeMedida,
              categoria: insumo.categoria,
              paraQueProducto: insumo.paraQueProducto,
              fechaYHora: new Date(),
              fecha: new Date(),
            },
          });
        }
      }

      this.appGateway.emitToCaja(SocketEvent.REFRESH_CAJA, { 
        action: 'abrir', 
        cajaId: caja.IDcaja 
      });

      this.notificationsService.sendNotification(
        'CAJA_OPENED',
        'Caja Abierta',
        `Se ha abierto una nueva caja: ${caja.nombre}`,
        { cajaId: caja.IDcaja }
      );

      return caja;
    });
  }

  async updateCaja(id: string, updateDto: any) {
    const caja = await this.prisma.aperturaCierreCaja.findUnique({
      where: { IDcaja: id },
    });
    if (!caja) throw new NotFoundException(`Caja con ID ${id} no encontrada`);

    const { insumos, insumosAEliminar, ...cajaData } = updateDto;

    return this.prisma.$transaction(async (tx) => {
      if (insumosAEliminar && insumosAEliminar.length > 0) {
        await tx.aperturaCierreInsumos.deleteMany({
          where: { Idcierreyapertura: { in: insumosAEliminar } }
        });
      }

      if (insumos && insumos.length > 0) {
        for (const insumo of insumos) {
          if (insumo.Idcierreyapertura) {
            // Find existing to compare
            const existing = await tx.aperturaCierreInsumos.findUnique({ where: { Idcierreyapertura: insumo.Idcierreyapertura }});
            
            const gastadoFisico = (insumo.cantApertura || 0) - (insumo.cantDeCierre || 0);
            await tx.aperturaCierreInsumos.update({
              where: { Idcierreyapertura: insumo.Idcierreyapertura },
              data: {
                cantApertura: insumo.cantApertura,
                cantDeCierre: insumo.cantDeCierre,
                seUtilizaron: gastadoFisico,
                observacion: insumo.observacion,
                paraQueProducto: insumo.paraQueProducto,
              },
            });

            // Log history if changed
            if (existing) {
              if (existing.cantApertura !== insumo.cantApertura) {
                await tx.historialCajaInsumos.create({
                  data: {
                    Idcierreyapertura: insumo.Idcierreyapertura,
                    usuario: updateDto.usuario || caja.nombre || 'Sistema',
                    campoModificado: 'cantApertura',
                    valorAnterior: String(existing.cantApertura || 0),
                    valorNuevo: String(insumo.cantApertura || 0),
                  }
                });
              }
              if (existing.cantDeCierre !== insumo.cantDeCierre) {
                await tx.historialCajaInsumos.create({
                  data: {
                    Idcierreyapertura: insumo.Idcierreyapertura,
                    usuario: updateDto.usuario || caja.nombre || 'Sistema',
                    campoModificado: 'cantDeCierre',
                    valorAnterior: String(existing.cantDeCierre || 0),
                    valorNuevo: String(insumo.cantDeCierre || 0),
                  }
                });
              }
            }

          } else {
            await tx.aperturaCierreInsumos.create({
              data: {
                IDcaja: id,
                nombreInsumo: insumo.nombreInsumo,
                cantApertura: insumo.cantApertura,
                cantDeCierre: insumo.cantDeCierre,
                unidadDeMedida: insumo.unidadDeMedida,
                categoria: insumo.categoria,
                observacion: insumo.observacion,
                fechaYHora: new Date(),
                fecha: new Date(),
                paraQueProducto: insumo.paraQueProducto,
              },
            });
          }
        }
      }

      if (Object.keys(cajaData).length > 0) {
        // Whitelist: only pass fields that exist in the Prisma schema
        const allowedFields = [
          'nombre', 'apertura', 'fechaDeApertura', 'horaDeApertura',
          'efectivoDeApertura', 'resumen', 'pdf', 'pdfcount', 'observaciones',
          'total12Onz', 'total24Onz', 'productos', 'tipoDeVaso',
          'cantAAgregar', 'plataGuardada', 'cuadroCaja', 'valorFaltante',
          'valorExcedente', 'transferenciasContadas', 'horaEnLaQueSeActualizo', 'contador', 'contador2'
        ];
        const parsedData: any = {};
        for (const key of allowedFields) {
          if (key in cajaData && cajaData[key as keyof typeof cajaData] !== undefined) {
            let value = (cajaData as any)[key];
            // Parse date strings to Date objects
            if ((key === 'fechaDeApertura') && typeof value === 'string') {
              value = new Date(value + 'T00:00:00.000Z');
            }
            parsedData[key] = value;
          }
        }
        parsedData.horaEnLaQueSeActualizo = new Date();

        await tx.aperturaCierreCaja.update({
          where: { IDcaja: id },
          data: parsedData,
        });
      }
      
      this.appGateway.emitToCaja(SocketEvent.REFRESH_CAJA, { 
        action: 'update', 
        cajaId: id 
      });

      if (insumos && insumos.length > 0) {
        this.notificationsService.sendNotification(
          'ORDER_INVENTARIO_UPDATED',
          'Ajuste de Insumos en Caja',
          `Se han modificado los insumos físicos en la caja: ${caja.nombre || 'Desconocida'}`,
          { cajaId: id }
        );
      }

      return tx.aperturaCierreCaja.findUnique({ where: { IDcaja: id } });
    }, { timeout: 30000 }); // 30 seconds timeout
  }

  async cerrarCaja(id: string, updateCierreDto: UpdateCierreCajaDto) {
    const caja = await this.prisma.aperturaCierreCaja.findUnique({
      where: { IDcaja: id },
      include: {
        venta: true,
      },
    });

    if (!caja) {
      throw new NotFoundException(`Caja con ID ${id} no encontrada`);
    }

    if (caja.cierre === 'cerrada') {
      throw new NotFoundException('Esta caja ya está cerrada');
    }

    const { insumos, ...cajaData } = updateCierreDto;

    return this.prisma.$transaction(async (tx) => {
      // 1. Actualizar Insumos
      if (insumos && insumos.length > 0) {
        for (const insumoCierre of insumos as any[]) {
          if (insumoCierre.Idcierreyapertura) {
            const existing = await tx.aperturaCierreInsumos.findUnique({
              where: { Idcierreyapertura: insumoCierre.Idcierreyapertura }
            });
            const gastadoFisico = (existing?.cantApertura || 0) - (insumoCierre.cantDeCierre || 0);

            await tx.aperturaCierreInsumos.update({
              where: { Idcierreyapertura: insumoCierre.Idcierreyapertura },
              data: {
                cantDeCierre: insumoCierre.cantDeCierre,
                observacion: insumoCierre.observacion,
                seUtilizaron: gastadoFisico,
                paraQueProducto: insumoCierre.paraQueProducto,
              },
            });

            if (existing && existing.cantDeCierre !== insumoCierre.cantDeCierre) {
              await tx.historialCajaInsumos.create({
                data: {
                  Idcierreyapertura: insumoCierre.Idcierreyapertura,
                  usuario: (updateCierreDto as any).usuario || caja.nombre || 'Sistema',
                  campoModificado: 'cantDeCierre',
                  valorAnterior: String(existing.cantDeCierre || 0),
                  valorNuevo: String(insumoCierre.cantDeCierre || 0),
                }
              });
            }
          }
        }
      }

      // 2. Actualizar Caja
      const allowedFields = [
        'nombre', 'apertura', 'fechaDeApertura', 'horaDeApertura',
        'efectivoDeApertura', 'fechaDeCierre', 'horaDeCierre',
        'efectivoDeCierre', 'resumen', 'pdf', 'pdfcount', 'observaciones',
        'cierre', 'total12Onz', 'total24Onz', 'productos', 'tipoDeVaso',
        'cantAAgregar', 'plataGuardada', 'cuadroCaja', 'valorFaltante',
        'valorExcedente', 'transferenciasContadas', 'horaEnLaQueSeActualizo', 'contador', 'contador2'
      ];
      const parsedCierreData: any = {};
      for (const key of allowedFields) {
        if (key in cajaData && (cajaData as any)[key] !== undefined) {
          let value = (cajaData as any)[key];
          if ((key === 'fechaDeApertura' || key === 'fechaDeCierre') && typeof value === 'string') {
            value = new Date(value + 'T00:00:00.000Z');
          }
          parsedCierreData[key] = value;
        }
      }

      const result = await tx.aperturaCierreCaja.update({
        where: { IDcaja: id },
        data: {
          ...parsedCierreData,
          fechaDeCierre: new Date(),
          cierre: 'cerrada',
          horaEnLaQueSeActualizo: new Date(),
          horaDeCierre: new Date().toTimeString().split(' ')[0],
        },
      });

      this.appGateway.emitToCaja(SocketEvent.REFRESH_CAJA, { 
        action: 'cerrar', 
        cajaId: id 
      });

      const hasMismatch = Number(result.valorFaltante || 0) > 0 || Number(result.valorExcedente || 0) > 0;
      
      if (hasMismatch) {
        this.notificationsService.sendNotification(
          'CAJA_CLOSED_MISMATCH',
          'Descuadre de Caja (Crítico)',
          `La caja ${result.nombre} cerró con descuadre. Faltante: $${result.valorFaltante || 0}, Excedente: $${result.valorExcedente || 0}`,
          { cajaId: id }
        );
      } else {
        this.notificationsService.sendNotification(
          'CAJA_CLOSED_PERFECT',
          'Caja Cuadrada Perfectamente',
          `La caja ${result.nombre} cerró cuadrada perfectamente.`,
          { cajaId: id }
        );
      }

      return result;
    }, { timeout: 30000 });
  }

  async findAll(query: CajaQueryDto) {
    const { nombre, fechaDesde, fechaHasta } = query;

    const where: Prisma.AperturaCierreCajaWhereInput = {};

    if (nombre) {
      where.nombre = nombre;
    }

    if (fechaDesde || fechaHasta) {
      where.fechaDeApertura = {};
      if (fechaDesde) {
        where.fechaDeApertura.gte = new Date(fechaDesde);
      }
      if (fechaHasta) {
        where.fechaDeApertura.lte = new Date(fechaHasta);
      }
    }

    return this.prisma.aperturaCierreCaja.findMany({
      where,
      orderBy: { fechaDeApertura: 'desc' },
    });
  }

  async findOne(id: string) {
    const caja = await this.prisma.aperturaCierreCaja.findUnique({
      where: { IDcaja: id },
      include: {
        venta: {
          where: {
            fecha: {
              gte: new Date(),
            },
          },
        },
      },
    });

    if (!caja) {
      throw new NotFoundException(`Caja con ID ${id} no encontrada`);
    }

    return caja;
  }

  async findCajaActiva() {
    return this.prisma.aperturaCierreCaja.findFirst({
      where: { cierre: 'abierta' },
      orderBy: { fechaDeApertura: 'desc' },
      include: {
        venta: {
          where: {
            fecha: {
              gte: new Date(),
            },
          },
        },
      },
    });
  }

  async getResumenCaja(id: string, horaCorteSnapshot?: string) {
    const caja = await this.findOne(id);

    if (!caja.fechaDeApertura) {
      throw new NotFoundException('La caja no tiene fecha de apertura');
    }

    // Ventas relacionadas con la caja (si no hay relación explícita por ID, usamos las fechas de la caja)
    // Asumimos que las ventas del turno son las que ocurrieron entre la apertura y el cierre (o ahora si no ha cerrado)
    // Asegurar que fechaInicio toma desde el inicio del día en hora local (UTC-5 Colombia)
    let fechaInicio = new Date(caja.fechaDeApertura);
    // Si la fecha viene como UTC midnight (ej. 2026-05-05T00:00:00.000Z), representa las 7PM del día anterior en Colombia.
    // Para que sea las 00:00:00 de Colombia, necesitamos sumar 5 horas.
    fechaInicio.setUTCHours(5, 0, 0, 0);

    // Asegurar que fechaFin toma hasta el final del día en hora local (UTC-5) o usar el Snapshot
    let fechaFin = new Date();
    if (horaCorteSnapshot) {
      fechaFin = new Date(horaCorteSnapshot);
    } else if (caja.fechaDeCierre) {
      fechaFin = new Date(caja.fechaDeCierre);
      fechaFin.setUTCHours(28, 59, 59, 999); // 23:59:59 local -> +5 = 28 (se ajusta al día siguiente automáticamente)
    }

    const allVentas = await this.prisma.ventas.findMany({
      where: { 
        estado: { in: ['PAGADO', 'ENTREGADO'] }, // SOLO COBRADOS O CERRADOS
        deletedAt: null, // IGNORAR LAS VENTAS ELIMINADAS (SOFT DELETE)
        fechaYHora: {
          gte: fechaInicio,
          lte: fechaFin,
        }
      },
      include: {
        ordenVentas: {
          include: {
            producto: {
              include: {
                recetaInsumos: true
              }
            }
          }
        }
      }
    });

    const notasAnalysis: any[] = [];
    const validVentas = allVentas.filter(v => v.estado !== 'ELIMINADA' && v.estado !== 'CANCELADO');

    let primerPedido = 'N/A';
    let ultimoPedido = 'N/A';
    
    const ventasOrdenadas = [...validVentas].sort((a, b) => {
      const timeA = new Date(a.fechaYHora || 0).getTime();
      const timeB = new Date(b.fechaYHora || 0).getTime();
      return timeA - timeB;
    });

    if (ventasOrdenadas.length > 0) {
      primerPedido = ventasOrdenadas[0].pedido || 'N/A';
      ultimoPedido = ventasOrdenadas[ventasOrdenadas.length - 1].pedido || 'N/A';
    }

    const rangoPedidos = {
      primerPedido,
      ultimoPedido,
      totalVentas: validVentas.length
    };

    validVentas.forEach(v => {
      let ventaHasNotes = false;
      const ventaNotes: any[] = [];

      v.ordenVentas.forEach(ov => {
        if ((ov as any).comentarios) {
          try {
            const parsed = JSON.parse((ov as any).comentarios);
            if (Array.isArray(parsed) && parsed.length > 0) {
              ventaHasNotes = true;
              
              // Normalizar las notas para que siempre tengan nombre y precio
              const normalizedNotas = parsed.map(n => {
                if (typeof n === 'string') return { nombre: n, precio: 0 };
                if (typeof n === 'object' && n !== null) {
                  return {
                    nombre: n.name || n.nombre || n.Nombre || 'Nota',
                    precio: Number(n.price || n.precio || n.Precio || 0)
                  };
                }
                return { nombre: String(n), precio: 0 };
              });

              ventaNotes.push({
                producto: (ov as any).nombreProducto || (ov as any).nombre || 'Producto',
                cantidad: ov.cantidad || 1,
                notas: normalizedNotas
              });
            } else if (typeof parsed === 'string' && parsed.trim().length > 0) {
              ventaHasNotes = true;
              ventaNotes.push({
                producto: (ov as any).nombreProducto || (ov as any).nombre || 'Producto',
                cantidad: ov.cantidad || 1,
                notas: [{ nombre: parsed.trim(), precio: 0 }]
              });
            }
          } catch (e) {
            if (typeof (ov as any).comentarios === 'string' && (ov as any).comentarios.trim().length > 0) {
              ventaHasNotes = true;
              ventaNotes.push({
                producto: (ov as any).nombreProducto || (ov as any).nombre || 'Producto',
                cantidad: ov.cantidad || 1,
                notas: [{ nombre: (ov as any).comentarios.trim(), precio: 0 }]
              });
            }
          }
        }
      });

      if (ventaHasNotes) {
        notasAnalysis.push({
          pedido: (v as any).pedido || 'Sin Pedido',
          hora: (v as any).hora,
          fecha: v.fecha,
          total: v.totalInput,
          productosConNotas: ventaNotes
        });
      }
    });

    let totalEfectivo = 0;
    let totalTransferencia = 0;
    let totalNequi = 0;
    let totalTarjeta = 0;
    let numeroOrdenesRepartidas = 0;
    let efectivoRepartido = 0;
    let transferenciasRepartidas = 0;

    for (const v of validVentas) {
      // Remover guiones bajos, espacios extras y pasar a mayúsculas para normalizar
      const medioRaw = (v.medioDePago || '').toUpperCase().replace(/_/g, ' ').trim();

      if (medioRaw === 'EFECTIVO') {
        totalEfectivo += Number(v.totalInput || 0);
      }
      else if (medioRaw === 'NEQUI') {
        totalNequi += Number(v.totalInput || 0);
      }
      else if (medioRaw === 'TRANSFERENCIA' || medioRaw === 'TRASNFERENCIA' || medioRaw === 'DAVIPLATA') {
        totalTransferencia += Number(v.totalInput || 0);
      }
      else if (medioRaw === 'TARJETA') {
        totalTarjeta += Number(v.totalInput || 0);
      }
      else if (medioRaw === 'MIXTO' || medioRaw === 'EFECTIVO Y OTROS') {
        const efectivoR = Number((v as any).efectivoRecibido || 0);
        const total = Number(v.totalInput || 0);
        // Transferencia repartida es el restante (Total - Efectivo)
        const tr = total - efectivoR;
        
        // Si es mixto y hay banco especificado como Nequi, lo sumamos a Nequi
        const bancoRaw = ((v as any).banco || '').toUpperCase().trim();
        if (bancoRaw === 'NEQUI') {
          totalNequi += tr;
        } else {
          totalTransferencia += tr;
        }

        totalEfectivo += efectivoR;
        
        // LAS ÓRDENES REPARTIDAS SON LAS DE MEDIO DE PAGO "EFECTIVO Y OTROS" (MIXTO)
        transferenciasRepartidas += tr;
        efectivoRepartido += efectivoR;
        numeroOrdenesRepartidas++;
      }
    }

    const insumosCaja = await this.prisma.aperturaCierreInsumos.findMany({
      where: { IDcaja: caja.IDcaja },
      include: { insumo: true, historial: { orderBy: { fechaYHora: 'desc' } } }
    });

    // Cargar todos los productos para mapear nombres
    const todosLosProductos = await this.prisma.productos.findMany({
      select: { IDproductos: true, nombre: true }
    });

    const insumosResumen = insumosCaja.map(ic => {
      const insumoId = ic.nombreInsumo || '';
      const productoIdDestino = ic.paraQueProducto || null;
      
      const productoAsociado = productoIdDestino 
        ? todosLosProductos.find(p => p.IDproductos === productoIdDestino || p.nombre === productoIdDestino)?.nombre 
        : null;

      let ventasEnSistema = 0;

      validVentas.forEach(v => {
        v.ordenVentas.forEach(ov => {
          // Si este insumo en la caja está filtrado para un producto específico,
          // saltar si la orden de venta no es de ese producto.
          // Se verifica tanto ID como nombre por si hay inconsistencias heredadas.
          if (productoIdDestino && 
              ov.producto?.IDproductos !== productoIdDestino && 
              ov.nombreProducto !== productoIdDestino && 
              ov.nombre !== productoIdDestino) {
            return;
          }

          if (ov.producto && ov.producto.recetaInsumos) {
            ov.producto.recetaInsumos.forEach(receta => {
              if (receta.insumo === insumoId) {
                const cant = (receta.cantidad || 1) * (ov.cantidad || 1);
                ventasEnSistema += cant;
              }
            });
          } else {
            // Fallback por si la receta no está populada pero el producto de la orden es el mismo insumo
            // (algunos sistemas asocian el ID del producto directamente con el insumo)
            if (ov.producto?.IDproductos === insumoId || ov.nombreProducto === insumoId) {
              ventasEnSistema += (ov.cantidad || 1);
            }
          }
        });
      });

      const gastadoFisico = ic.seUtilizaron || 0;
      const diferencia = gastadoFisico - ventasEnSistema;
      
      return {
        ...ic,
        ventasEnSistema,
        diferencia,
        // We pass the actual name for the UI from the relation if available
        nombreReal: ic.insumo?.nombre || insumoId,
        nombreProductoReal: productoAsociado || productoIdDestino || 'N/A'
      };
    });

    const efectivoEsperado = Number(caja.efectivoDeApertura || 0) + totalEfectivo;

    return {
      caja,
      rangoPedidos,
      notasAnalysis,
      resumen: {
        totalEfectivo,
        totalTransferencia,
        totalNequi,
        totalTarjeta,
        numeroOrdenesRepartidas,
        efectivoRepartido,
        transferenciasRepartidas,
        totalVentas: totalEfectivo + totalTransferencia + totalNequi + totalTarjeta,
        efectivoApertura: caja.efectivoDeApertura,
        efectivoCierre: caja.efectivoDeCierre,
        efectivoEsperado,
        plataGuardada: caja.plataGuardada,
        valorFaltante: caja.valorFaltante,
        valorExcedente: caja.valorExcedente,
      },
      insumos: insumosResumen,
    };
  }

  async remove(id: string) {
    const caja = await this.prisma.aperturaCierreCaja.findUnique({
      where: { IDcaja: id },
    });
    if (!caja) {
      throw new NotFoundException(`Caja con ID ${id} no encontrada`);
    }

    return this.prisma.$transaction(async (tx) => {
      // First delete all related insumos and their histories
      const insumos = await tx.aperturaCierreInsumos.findMany({
        where: { IDcaja: id },
      });
      const insumosIds = insumos.map(i => i.Idcierreyapertura);

      await tx.historialCajaInsumos.deleteMany({
        where: { Idcierreyapertura: { in: insumosIds } },
      });

      await tx.aperturaCierreInsumos.deleteMany({
        where: { IDcaja: id },
      });

      // Then delete the caja
      const deletedCaja = await tx.aperturaCierreCaja.delete({
        where: { IDcaja: id },
      });

      this.appGateway.emitToCaja(SocketEvent.REFRESH_CAJA, { 
        action: 'delete', 
        cajaId: id 
      });

      this.notificationsService.sendNotification(
        'CAJA_DELETED',
        'Caja Eliminada',
        `Se eliminó la caja: ${caja.nombre}`,
        { cajaId: id }
      );

      return deletedCaja;
    });
  }
}
