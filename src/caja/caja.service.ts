import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateAperturaCierreCajaDto, UpdateCierreCajaDto, CajaQueryDto } from './dto/caja.dto';
import { Prisma } from '@prisma/client';
import { AppGateway } from '../websocket/app.gateway';
import { SocketEvent } from '../websocket/types/socket.types';
import { NotificationsService } from '../notifications/notifications.service';
import { AiService } from '../ai/ai.service';

@Injectable()
export class CajaService {
  constructor(
    private prisma: PrismaService,
    private appGateway: AppGateway,
    private notificationsService: NotificationsService,
    private aiService: AiService,
  ) {}

  private async getFechaContable(date: Date = new Date(), manualDate?: string): Promise<Date> {
    if (manualDate) {
      const parts = manualDate.split('-');
      if (parts.length === 3) {
        return new Date(Date.UTC(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2])));
      }
    }

    let config = await this.prisma.configuracionNegocio.findUnique({ where: { id: 1 } });
    if (!config) {
      config = { id: 1, nombreComercial: 'Q HUBO MOR', nit: null, direccion: null, telefono: null, horaCorteDia: '00:00', modoOperacion: 'GENERAL', latitudNegocio: null, longitudNegocio: null, radioGeocercaM: 100, updatedAt: new Date() };
    }
    
    const [corteHours, corteMinutes] = config.horaCorteDia.split(':').map(Number);
    const localDate = new Date(date.getTime() - (5 * 60 * 60 * 1000));
    const currentMinutes = (localDate.getUTCHours() * 60) + localDate.getUTCMinutes();
    const corteTotalMinutes = (corteHours * 60) + corteMinutes;

    if (currentMinutes < corteTotalMinutes) {
      localDate.setUTCDate(localDate.getUTCDate() - 1);
    }
    localDate.setUTCHours(0, 0, 0, 0);
    return localDate;
  }

  async abrirCaja(createCajaDto: CreateAperturaCierreCajaDto) {
    const { insumos, ...cajaData } = createCajaDto;

    // Whitelist fields for aperturaCierreCaja creation
    const allowedFields = [
        'nombre', 'apertura', 'fechaDeApertura', 'horaDeApertura',
        'efectivoDeApertura', 'fechaDeCierre', 'horaDeCierre',
        'efectivoDeCierre', 'resumen', 'pdf', 'pdfcount', 'observaciones',
        'cierre', 'total12Onz', 'total24Onz', 'productos', 'tipoDeVaso',
        'cantAAgregar', 'plataGuardada', 'cuadroCaja', 'valorFaltante',
        'valorExcedente', 'transferenciasContadas', 'horaCongelada', 'contador', 'contador2'
      ];
    const decimalFieldsSet = new Set([
      'plataGuardada', 'valorFaltante', 'valorExcedente',
      'efectivoDeCierre', 'efectivoDeApertura', 'transferenciasContadas', 'cantAAgregar'
    ]);
    const parsedData: any = {};
    for (const key of allowedFields) {
      if (key in cajaData && (cajaData as any)[key] !== undefined) {
        let value = (cajaData as any)[key];
        if ((key === 'fechaDeApertura' || key === 'fechaDeCierre') && typeof value === 'string') {
          value = new Date(value + 'T12:00:00.000Z');
        }
        // Guard: Prisma rejects empty strings for Decimal columns
        if (decimalFieldsSet.has(key) && (value === '' || value === null)) {
          continue;
        }
        parsedData[key] = value;
      }
    }

    const fechaContableFinal = parsedData.fechaDeApertura 
      ? parsedData.fechaDeApertura 
      : await this.getFechaContable();

    const cajaCreada = await this.prisma.$transaction(async (tx) => {
      const caja = await tx.aperturaCierreCaja.create({
        data: {
          ...parsedData,
          fechaDeApertura: fechaContableFinal,
          horaDeApertura: new Date().toLocaleTimeString('en-US', { timeZone: 'America/Bogota', hour12: true }),
          cierre: 'abierta',
          cuadroCaja: 'NO SE HA REVISADO',
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

      return caja;
    });

    this.appGateway.emitToCaja(SocketEvent.REFRESH_CAJA, { 
      action: 'abrir', 
      cajaId: cajaCreada.IDcaja 
    });

    this.notificationsService.sendNotification(
      'CAJA_OPENED',
      'Caja Abierta',
      `Se ha abierto una nueva caja: ${cajaCreada.nombre}`,
      { cajaId: cajaCreada.IDcaja }
    );

    return cajaCreada;
  }

  async updateCaja(id: string, updateDto: any) {
    const caja = await this.prisma.aperturaCierreCaja.findUnique({
      where: { IDcaja: id },
    });
    if (!caja) throw new NotFoundException(`Caja con ID ${id} no encontrada`);

    const { insumos, insumosAEliminar, updaterName, ...cajaData } = updateDto;

    // Usar la fecha de la caja (no hoy) para nuevos insumos que se agreguen a cajas históricas
    const cajaFecha = caja.fechaDeApertura
      ? new Date(caja.fechaDeApertura)
      : new Date();
    // Normalizar a mediodia Colombia para evitar desfases de timezone
    cajaFecha.setUTCHours(17, 0, 0, 0); // 17:00 UTC = 12:00 Colombia (UTC-5)

    const updatedCaja = await this.prisma.$transaction(async (tx) => {
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
                fechaYHora: cajaFecha,
                fecha: cajaFecha,
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
            'efectivoDeApertura', 'fechaDeCierre', 'horaDeCierre', 'efectivoDeCierre', 
            'resumen', 'pdf', 'pdfcount', 'observaciones',
            'cierre', 'total12Onz', 'total24Onz', 'productos', 'tipoDeVaso',
            'cantAAgregar', 'plataGuardada', 'cuadroCaja', 'valorFaltante',
            'valorExcedente', 'transferenciasContadas', 'horaCongelada', 'horaEnLaQueSeActualizo', 'contador', 'contador2'
          ];
        const decimalFields = new Set([
          'plataGuardada', 'valorFaltante', 'valorExcedente',
          'efectivoDeCierre', 'efectivoDeApertura', 'transferenciasContadas', 'cantAAgregar'
        ]);
        const parsedData: any = {};
        for (const key of allowedFields) {
          if (key in cajaData && cajaData[key as keyof typeof cajaData] !== undefined) {
            let value = (cajaData as any)[key];
            // Parse date strings to Date objects
            if ((key === 'fechaDeApertura' || key === 'fechaDeCierre') && typeof value === 'string') {
              value = new Date(value + 'T12:00:00.000Z');
            }
            // Guard: Prisma rejects empty strings for Decimal columns
            if (decimalFields.has(key) && (value === '' || value === null)) {
              continue;
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
      
      return tx.aperturaCierreCaja.findUnique({ where: { IDcaja: id } });
    }, { timeout: 30000 }); // 30 seconds timeout

    this.appGateway.emitToCaja(SocketEvent.REFRESH_CAJA, { 
      action: 'update', 
      cajaId: id,
      updaterName
    });

    if (insumos && insumos.length > 0) {
      this.notificationsService.sendNotification(
        'ORDER_INVENTARIO_UPDATED',
        'Ajuste de Insumos en Caja',
        `Se han modificado los insumos físicos en la caja: ${caja.nombre || 'Desconocida'}`,
        { cajaId: id }
      );
    }

    return updatedCaja;
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

    // Validar que no haya verificación pendiente sin completar
    const verificacion = await this.getVerificacionPendiente(id);
    if (!verificacion.todasVerificadas) {
      throw new BadRequestException(
        `Hay ${verificacion.totalPendientes} insumos sin verificar. Debes hacer la verificación antes de cerrar definitivamente la caja.`
      );
    }

      const { insumos, updaterName, ...cajaData } = updateCierreDto as any;

    const closedCaja = await this.prisma.$transaction(async (tx) => {
      // 0. Eliminar insumos si es necesario (para que no quede rastro en la base de datos si el usuario los quitó del UI)
      if ((updateCierreDto as any).insumosAEliminar && (updateCierreDto as any).insumosAEliminar.length > 0) {
        await tx.aperturaCierreInsumos.deleteMany({
          where: { Idcierreyapertura: { in: (updateCierreDto as any).insumosAEliminar } }
        });
      }

      // 1. Actualizar Insumos
      if (insumos && insumos.length > 0) {
        for (const insumoCierre of insumos as any[]) {
          if (insumoCierre.Idcierreyapertura) {
            const existing = await tx.aperturaCierreInsumos.findUnique({
              where: { Idcierreyapertura: insumoCierre.Idcierreyapertura }
            });
            const gastadoFisico = (insumoCierre.cantApertura !== undefined ? insumoCierre.cantApertura : (existing?.cantApertura || 0)) - (insumoCierre.cantDeCierre || 0);

            await tx.aperturaCierreInsumos.update({
              where: { Idcierreyapertura: insumoCierre.Idcierreyapertura },
              data: {
                cantApertura: insumoCierre.cantApertura !== undefined ? insumoCierre.cantApertura : existing?.cantApertura,
                cantDeCierre: insumoCierre.cantDeCierre,
                observacion: insumoCierre.observacion,
                seUtilizaron: gastadoFisico,
                paraQueProducto: insumoCierre.paraQueProducto,
              },
            });

            if (existing && existing.cantApertura !== insumoCierre.cantApertura && insumoCierre.cantApertura !== undefined) {
              await tx.historialCajaInsumos.create({
                data: {
                  Idcierreyapertura: insumoCierre.Idcierreyapertura,
                  usuario: (updateCierreDto as any).usuario || caja.nombre || 'Sistema',
                  campoModificado: 'cantApertura',
                  valorAnterior: String(existing.cantApertura || 0),
                  valorNuevo: String(insumoCierre.cantApertura || 0),
                }
              });
            }

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
          } else {
            // Es un insumo nuevo agregado en el momento del cierre
            await tx.aperturaCierreInsumos.create({
              data: {
                IDcaja: id,
                nombreInsumo: insumoCierre.nombreInsumo,
                cantApertura: insumoCierre.cantApertura || 0,
                cantDeCierre: insumoCierre.cantDeCierre || 0,
                seUtilizaron: (insumoCierre.cantApertura || 0) - (insumoCierre.cantDeCierre || 0),
                observacion: insumoCierre.observacion || '',
                paraQueProducto: insumoCierre.paraQueProducto || '',
              }
            });
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
          'valorExcedente', 'transferenciasContadas', 'horaCongelada', 'horaEnLaQueSeActualizo', 'contador', 'contador2'
        ];
      const decimalCierreFields = new Set([
        'plataGuardada', 'valorFaltante', 'valorExcedente',
        'efectivoDeCierre', 'efectivoDeApertura', 'transferenciasContadas', 'cantAAgregar'
      ]);
      const parsedCierreData: any = {};
      for (const key of allowedFields) {
        if (key in cajaData && (cajaData as any)[key] !== undefined) {
          let value = (cajaData as any)[key];
          if ((key === 'fechaDeApertura' || key === 'fechaDeCierre') && typeof value === 'string') {
            value = new Date(value + 'T12:00:00.000Z');
          }
          // Guard: Prisma rejects empty strings for Decimal columns
          if (decimalCierreFields.has(key) && (value === '' || value === null)) {
            continue;
          }
          parsedCierreData[key] = value;
        }
      }

      const result = await tx.aperturaCierreCaja.update({
        where: { IDcaja: id },
        data: {
          ...parsedCierreData,
          fechaDeCierre: parsedCierreData.fechaDeCierre || new Date(),
          cierre: 'cerrada',
          horaEnLaQueSeActualizo: new Date(),
          horaDeCierre: parsedCierreData.horaDeCierre || new Date().toLocaleTimeString('en-US', { timeZone: 'America/Bogota', hour12: true }),
        },
      });

      return result;
    }, { timeout: 30000 });

    this.appGateway.emitToCaja(SocketEvent.REFRESH_CAJA, { 
      action: 'cerrar', 
      cajaId: id,
      updaterName
    });

    const hasMismatch = Number(closedCaja.valorFaltante || 0) > 0 || Number(closedCaja.valorExcedente || 0) > 0;
    
    if (hasMismatch) {
      this.notificationsService.sendNotification(
        'CAJA_CLOSED_MISMATCH',
        'Descuadre de Caja (Crítico)',
        `La caja ${closedCaja.nombre} cerró con descuadre. Faltante: $${closedCaja.valorFaltante || 0}, Excedente: $${closedCaja.valorExcedente || 0}`,
        { cajaId: id }
      );
    } else {
      this.notificationsService.sendNotification(
        'CAJA_CLOSED_PERFECT',
        'Caja Cuadrada Perfectamente',
        `La caja ${closedCaja.nombre} cerró cuadrada perfectamente.`,
        { cajaId: id }
      );
    }

    return closedCaja;
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

  private async getCajaTimeBounds(caja: any, horaCorteSnapshot?: string) {
    let fechaInicio: Date | undefined = undefined;

    const whereAnterior: Prisma.AperturaCierreCajaWhereInput = {
      fechaDeApertura: caja.fechaDeApertura,
      cierre: 'cerrada',
      IDcaja: { not: caja.IDcaja } // Asegurar que no traiga la caja actual
    };

    if (caja.createdAt) {
      whereAnterior.createdAt = { lt: caja.createdAt };
    }

    // Buscar si hubo una caja anterior el mismo día contable
    const cajaAnterior = await this.prisma.aperturaCierreCaja.findFirst({
      where: whereAnterior,
      orderBy: { createdAt: 'desc' }
    });

    if (cajaAnterior) {
      if (cajaAnterior.horaCongelada) {
        fechaInicio = new Date(cajaAnterior.horaCongelada);
      } else if (cajaAnterior.updatedAt) {
        fechaInicio = cajaAnterior.updatedAt;
      } else if (cajaAnterior.createdAt) {
        fechaInicio = cajaAnterior.createdAt;
      }
    }

    let fechaFin = new Date();
    if (horaCorteSnapshot) {
      fechaFin = new Date(horaCorteSnapshot);
    } else if (caja.horaCongelada) {
      fechaFin = new Date(caja.horaCongelada);
    } else if (caja.fechaDeCierre) {
      fechaFin = new Date(caja.fechaDeCierre);
      fechaFin.setUTCHours(28, 59, 59, 999);
    }

    if (fechaInicio && fechaFin && fechaInicio.getTime() > fechaFin.getTime()) {
      fechaInicio = undefined;
    }

    return { fechaInicio, fechaFin };
  }

  async getResumenCaja(id: string, horaCorteSnapshot?: string) {
    const caja = await this.findOne(id);

    if (!caja.fechaDeApertura) {
      throw new NotFoundException('La caja no tiene fecha de apertura');
    }

    const { fechaInicio, fechaFin } = await this.getCajaTimeBounds(caja, horaCorteSnapshot);

    const allVentas = await this.prisma.ventas.findMany({
      where: { 
        estado: { in: ['PAGADO', 'ENTREGADO'] }, // SOLO COBRADOS O CERRADOS
        deletedAt: null, // IGNORAR LAS VENTAS ELIMINADAS (SOFT DELETE)
        fecha: caja.fechaDeApertura, // Utilizar el día contable exacto (horaCorteDia)
        fechaYHora: {
          gte: fechaInicio,
          lte: fechaFin, // Limitar a la hora en que se cerró/congeló la caja
        }
      },
      include: {
        clienteRelacion: true,
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
                if (typeof n === 'string') return { nombre: n, precio: 0, cantidad: 1 };
                if (typeof n === 'object' && n !== null) {
                  return {
                    nombre: n.name || n.nombre || n.Nombre || 'Nota',
                    precio: Number(n.price || n.precio || n.Precio || 0),
                    cantidad: Number(n.quantity || n.cantidad || 1)
                  };
                }
                return { nombre: String(n), precio: 0, cantidad: 1 };
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
                notas: [{ nombre: parsed.trim(), precio: 0, cantidad: 1 }]
              });
            }
          } catch (e) {
            if (typeof (ov as any).comentarios === 'string' && (ov as any).comentarios.trim().length > 0) {
              ventaHasNotes = true;
              ventaNotes.push({
                producto: (ov as any).nombreProducto || (ov as any).nombre || 'Producto',
                cantidad: ov.cantidad || 1,
                notas: [{ nombre: (ov as any).comentarios.trim(), precio: 0, cantidad: 1 }]
              });
            }
          }
        }
      });

      if (ventaHasNotes || Number(v.descuento) > 0 || v.clienteRelacion) {
        notasAnalysis.push({
          ventaId: v.IDventas,
          pedido: (v as any).pedido || 'Sin Pedido',
          hora: (v as any).hora,
          fecha: v.fecha,
          total: v.totalInput,
          descuento: Number(v.descuento || 0),
          porcentajeDeDescuento: v.porcentajeDeDescuento || null,
          cliente: v.clienteRelacion ? {
            nombre: v.clienteRelacion.nombre,
            telefono: v.clienteRelacion.whatsapp
          } : null,
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

    let cantEfectivo = 0;
    let cantTransferencia = 0;
    let cantNequi = 0;
    let cantTarjeta = 0;

    for (const v of validVentas) {
      // Remover guiones bajos, espacios extras y pasar a mayúsculas para normalizar
      const medioRaw = (v.medioDePago || '').toUpperCase().replace(/_/g, ' ').trim();

      if (medioRaw === 'EFECTIVO') {
        totalEfectivo += Number(v.totalInput || 0);
        cantEfectivo++;
      }
      else if (medioRaw === 'NEQUI') {
        totalNequi += Number(v.totalInput || 0);
        cantNequi++;
      }
      else if (medioRaw === 'TRANSFERENCIA' || medioRaw === 'TRASNFERENCIA' || medioRaw === 'DAVIPLATA') {
        totalTransferencia += Number(v.totalInput || 0);
        cantTransferencia++;
      }
      else if (medioRaw === 'TARJETA') {
        totalTarjeta += Number(v.totalInput || 0);
        cantTarjeta++;
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

      // paraQueProducto can now be a JSON array of product IDs, or a legacy string
      const rawParaQueProducto = ic.paraQueProducto || ic.nombreDelProducto;
      let productosDestino: string[] = [];
      if (Array.isArray(rawParaQueProducto)) {
        productosDestino = rawParaQueProducto as string[];
      } else if (typeof rawParaQueProducto === 'string' && rawParaQueProducto.trim()) {
        try {
          const parsed = JSON.parse(rawParaQueProducto);
          productosDestino = Array.isArray(parsed) ? parsed : [rawParaQueProducto.trim()];
        } catch (e) {
          productosDestino = [rawParaQueProducto.trim()];
        }
      }

      // Map each product ID to its name
      const productosAsociados = productosDestino.map(pid => {
        const found = todosLosProductos.find(p => p.IDproductos === pid || p.nombre === pid);
        return { id: pid, nombre: found?.nombre || pid };
      });

      let ventasEnSistema = 0;
      // Detail: how many units sold per product that uses this insumo
      const ventasPorProducto: Record<string, number> = {};

      validVentas.forEach(v => {
        v.ordenVentas.forEach(ov => {
          // If filtered to specific products, skip orders for other products
          if (productosDestino.length > 0) {
            const ovProdId = ov.producto?.IDproductos || '';
            const ovProdNombre = ov.nombreProducto || ov.nombre || '';
            const matches = productosDestino.some(pid =>
              pid === ovProdId || pid === ovProdNombre
            );
            if (!matches) return;
          }

          if (ov.producto && ov.producto.recetaInsumos) {
            ov.producto.recetaInsumos.forEach(receta => {
              if (receta.insumo === insumoId) {
                const cant = (receta.cantidad || 1) * (ov.cantidad || 1);
                ventasEnSistema += cant;
                const pNombre = ov.producto?.nombre || ov.nombreProducto || 'N/A';
                ventasPorProducto[pNombre] = (ventasPorProducto[pNombre] || 0) + (ov.cantidad || 1);
              }
            });
          } else {
            if (ov.producto?.IDproductos === insumoId || ov.nombreProducto === insumoId) {
              ventasEnSistema += (ov.cantidad || 1);
              const pNombre = ov.producto?.nombre || ov.nombreProducto || 'N/A';
              ventasPorProducto[pNombre] = (ventasPorProducto[pNombre] || 0) + (ov.cantidad || 1);
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
        nombreReal: ic.insumo?.nombre || insumoId,
        // List of all product names associated with this insumo
        productosAsociados,
        nombreProductoReal: productosAsociados.map(p => p.nombre).join(', ') || 'N/A',
        // Detail of how many units sold per product (for restaurant report)
        ventasPorProducto,
      };
    });

    // --- Ventas por Categoría y por Producto (para el reporte de restaurante) ---
    const ventasPorCategoriaMap: Record<string, { totalUnidades: number; totalIngresos: number; productos: Record<string, number> }> = {};
    const ventasPorProductoMap: Record<string, { nombre: string; cantidad: number; totalIngresos: number }> = {};

    validVentas.forEach(v => {
      v.ordenVentas.forEach(ov => {
        const cat = (ov.producto as any)?.categoriaNombre || (ov.producto as any)?.categoria || 'Sin Categoría';
        const prodNombre = (ov.producto as any)?.nombre || ov.nombreProducto || ov.nombre || 'Producto';
        const prodId = ov.producto?.IDproductos || prodNombre;
        const cant = ov.cantidad || 1;
        const ingreso = Number(ov.precioTotal || 0);

        if (!ventasPorCategoriaMap[cat]) {
          ventasPorCategoriaMap[cat] = { totalUnidades: 0, totalIngresos: 0, productos: {} };
        }
        ventasPorCategoriaMap[cat].totalUnidades += cant;
        ventasPorCategoriaMap[cat].totalIngresos += ingreso;
        ventasPorCategoriaMap[cat].productos[prodNombre] = (ventasPorCategoriaMap[cat].productos[prodNombre] || 0) + cant;

        if (!ventasPorProductoMap[prodId]) {
          ventasPorProductoMap[prodId] = { nombre: prodNombre, cantidad: 0, totalIngresos: 0 };
        }
        ventasPorProductoMap[prodId].cantidad += cant;
        ventasPorProductoMap[prodId].totalIngresos += ingreso;
      });
    });

    const ventasPorCategoria = Object.entries(ventasPorCategoriaMap).map(([categoria, data]) => ({
      categoria,
      totalUnidades: data.totalUnidades,
      totalIngresos: data.totalIngresos,
      productos: Object.entries(data.productos).map(([nombre, cantidad]) => ({ nombre, cantidad }))
        .sort((a, b) => b.cantidad - a.cantidad),
    })).sort((a, b) => b.totalUnidades - a.totalUnidades);

    const ventasPorProducto = Object.values(ventasPorProductoMap)
      .sort((a, b) => b.cantidad - a.cantidad);

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
        cantEfectivo,
        cantTransferencia,
        cantNequi,
        cantTarjeta,
        totalVentas: totalEfectivo + totalTransferencia + totalNequi + totalTarjeta,
        efectivoApertura: caja.efectivoDeApertura,
        efectivoCierre: caja.efectivoDeCierre,
        efectivoEsperado,
        plataGuardada: caja.plataGuardada,
        valorFaltante: caja.valorFaltante,
        valorExcedente: caja.valorExcedente,
      },
      insumos: insumosResumen,
      ventasPorCategoria,
      ventasPorProducto,
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

  async getAutoCuadrePreview(cajaId: string) {
    const caja = await this.prisma.aperturaCierreCaja.findUnique({ where: { IDcaja: cajaId } });
    if (!caja) throw new NotFoundException('Caja no encontrada');

    const resumenCompleto = await this.getResumenCaja(cajaId);

    const insumosDescuadrados = resumenCompleto.insumos
      .filter((i: any) => i.diferencia !== 0)
      .map((i: any) => ({
        insumo: i.nombreReal,
        productoId: i.productosAsociados?.[0]?.id || '',
        productoAsociado: i.nombreProductoReal,
        diferencia: i.diferencia,
      }));

    const efectivoEsperado = Number(resumenCompleto.resumen.efectivoEsperado || 0);
    const efectivoContado = Number(resumenCompleto.caja.efectivoDeCierre || 0);
    const diferenciaEfectivo = efectivoContado - efectivoEsperado;

    const transferenciasEsperadas = Number(resumenCompleto.resumen.totalTransferencia || 0) + Number(resumenCompleto.resumen.totalNequi || 0);
    const transferenciasContadas = Number(resumenCompleto.caja.transferenciasContadas || 0);
    const diferenciaTransferencia = transferenciasContadas - transferenciasEsperadas;

    const hasInsumosDescuadre = insumosDescuadrados.length > 0;
    const hasMonetaryDescuadre = diferenciaEfectivo !== 0 || diferenciaTransferencia !== 0;

    if (!hasInsumosDescuadre && !hasMonetaryDescuadre) {
      throw new BadRequestException('La caja ya está cuadrada. No hay diferencias físicas ni monetarias.');
    }

    const { fechaInicio, fechaFin } = await this.getCajaTimeBounds(caja);
    
    const ventasEfectivo = await this.prisma.ventas.findMany({
      where: {
        estado: { in: ['PAGADO', 'ENTREGADO'] },
        deletedAt: null,
        medioDePago: { in: ['EFECTIVO', 'TRANSFERENCIA', 'NEQUI', 'TRASNFERENCIA', 'DAVIPLATA'] },
        fecha: caja.fechaDeApertura, // Matchear con el día contable exacto (horaCorteDia)
        fechaYHora: { 
          gte: fechaInicio,
          lte: fechaFin 
        }
      },
      include: {
        ordenVentas: {
          include: { producto: true }
        },
        usuarioRelacion: true,
        mesaRelacion: true
      }
    });

    const ventasEligibles = ventasEfectivo.filter(v => {
      // Filtrar ventas que tengan comentarios (para no complicar los cálculos de precios)
      return !v.ordenVentas.some(ov => ov.comentarios && ov.comentarios.trim().length > 0);
    }).map(v => {
      const mesaStr = v.mesaRelacion?.nombre || v.mesa || 'Sin Mesa';
      const usuarioStr = v.usuarioRelacion?.nombre || v.usuario || 'Sin Usuario';
      const pedidoStr = v.pedido || 'Sin Pedido';

      return {
        ventaId: v.IDventas,
        pedido: `${mesaStr} - ${usuarioStr} - ${pedidoStr}`,
        total: Number(v.totalInput),
        metodo: v.medioDePago,
        productos: v.ordenVentas.map(ov => ({
          ordenId: ov.IDorderventas,
          productoId: ov.productoId || '',
          nombre: ov.producto?.nombre || ov.nombreProducto,
          cantidad: Number(ov.cantidad),
          precioTotal: Number(ov.precioTotal)
        }))
      };
    });

    const datosCaja = {
      insumosDescuadrados,
      descuadreMonetario: {
        faltante: Number(resumenCompleto.resumen.valorFaltante),
        excedente: Number(resumenCompleto.resumen.valorExcedente),
        diferenciaEfectivo,
        diferenciaTransferencia,
        efectivoEsperado,
        efectivoContado,
        transferenciasEsperadas,
        transferenciasContadas
      },
      ventasEligibles,
      observaciones: caja.observaciones || ''
    };

    const plan = await this.aiService.autoCuadrePreview(datosCaja);

    // ========================================================================
    // DEFENSE-IN-DEPTH: Post-process AI response deterministically.
    // The AI is unreliable at choosing remove vs add based on sign.
    // We force-correct every action based on math, and fill gaps.
    // ========================================================================
    console.log('[AutoCuadre] Plan RAW de IA:', JSON.stringify(plan, null, 2));

    const correctedAcciones: any[] = [];
    const differenceTracker = new Map<string, number>();
    for (const d of insumosDescuadrados) {
      differenceTracker.set(d.productoAsociado, Math.abs(d.diferencia));
    }
    let remainingDiferenciaTransferencia = Math.abs(diferenciaTransferencia);

    // Step 1: Validate and correct each AI-generated action
    if (plan.acciones && Array.isArray(plan.acciones)) {
      for (const accion of plan.acciones) {
        // Find which descuadre this action addresses
        const matchingDescuadre = insumosDescuadrados.find(d => {
          const prodId = d.productoId;
          const prodName = d.productoAsociado;
          return (
            accion.productoId === prodId ||
            accion.nombreProducto === prodName ||
            (accion.nombreProducto && prodName.includes(accion.nombreProducto)) ||
            (accion.nombreProducto && accion.nombreProducto.includes(prodName))
          );
        });

        if (accion.action === 'change_payment') {
          // VALIDACIÓN: Enforzar que EFECTIVO Y OTROS sume exactamente el total de la venta
          if (accion.method === 'EFECTIVO Y OTROS' && accion.ventaId) {
            const targetSale = ventasEligibles.find(v => v.ventaId === accion.ventaId);
            if (targetSale) {
              const saleTotal = Number(targetSale.total);
              let ef = Number(accion.efectivoRecibido || 0);
              let tr = Number(accion.transferenciaRecibida || 0);
              
              if (ef + tr !== saleTotal) {
                if (tr > 0 && tr <= saleTotal) {
                  ef = saleTotal - tr;
                } else if (ef > 0 && ef <= saleTotal) {
                  tr = saleTotal - ef;
                } else {
                  tr = saleTotal;
                  ef = 0;
                }
                accion.efectivoRecibido = ef;
                accion.transferenciaRecibida = tr;
                accion.motivo = accion.motivo + ` (Ajuste Backend: Sumas corregidas al total de $${saleTotal})`;
              }
            }
          }
          correctedAcciones.push(accion);
          continue;
        }

        if (matchingDescuadre) {
          const diff = matchingDescuadre.diferencia;
          const remaining = differenceTracker.get(matchingDescuadre.productoAsociado) || 0;
          if (remaining <= 0) continue; // Already addressed fully

          // Si la IA decidió ignorar basado en las observaciones (ej. vasos dañados)
          if (accion.action === 'ignore') {
            const ignoredQuantity = Number(accion.cantidadAIgnorar || remaining);
            const applyQuantity = Math.min(ignoredQuantity, remaining);
            differenceTracker.set(matchingDescuadre.productoAsociado, remaining - applyQuantity);
            correctedAcciones.push({
              ...accion,
              action: 'ignore',
              motivo: accion.motivo || `Diferencia ignorada según observaciones (justificada).`,
            });
            continue;
          }

          const suggestedQuantity = Number(accion.cantidadAAnadir || accion.cantidadARemover || 1);
          const applyQuantity = Math.min(suggestedQuantity, remaining);
          differenceTracker.set(matchingDescuadre.productoAsociado, remaining - applyQuantity);

          if (diff > 0) {
            // PHYSICAL > SYSTEM → must ADD products to system
            correctedAcciones.push({
              ...accion,
              action: 'add_product',
              cantidadAAnadir: applyQuantity,
              cantidadARemover: undefined,
              productoId: matchingDescuadre.productoId || accion.productoId,
              nombreProducto: matchingDescuadre.productoAsociado || accion.nombreProducto,
              motivo: accion.motivo || `Se detectó un faltante en el sistema para ${matchingDescuadre.productoAsociado}. Se añaden al sistema para igualar el conteo físico.`,
            });
          } else if (diff < 0) {
            // SYSTEM > PHYSICAL → must REMOVE products from system
            correctedAcciones.push({
              ...accion,
              action: 'remove_product',
              cantidadARemover: applyQuantity,
              cantidadAAnadir: undefined,
              productoId: matchingDescuadre.productoId || accion.productoId,
              nombreProducto: matchingDescuadre.productoAsociado || accion.nombreProducto,
              motivo: accion.motivo || `Se detectó un excedente en el sistema para ${matchingDescuadre.productoAsociado}. Se remueven del sistema para igualar el conteo físico.`,
            });
          }
        } else {
          // Action doesn't match any descuadre - keep as-is (could be a payment change)
          correctedAcciones.push(accion);
        }
      }
    }

    // Step 2: Fill in missing actions for descuadres the AI didn't address or didn't fully address
    for (const desc of insumosDescuadrados) {
      const remaining = differenceTracker.get(desc.productoAsociado) || 0;
      if (remaining <= 0) continue;

      if (desc.diferencia > 0) {
        // Need to ADD — pick first eligible sale
        const targetSale = ventasEligibles[0];
        if (targetSale) {
          correctedAcciones.push({
            action: 'add_product',
            ventaId: targetSale.ventaId,
            productoId: desc.productoId,
            nombreProducto: desc.productoAsociado,
            cantidadAAnadir: remaining,
            motivo: `El sistema registró unidades menos que el consumo físico de ${desc.productoAsociado}. Se añade al pedido ${targetSale.pedido || targetSale.ventaId} para cuadrar.`,
          });
        }
      } else {
        // Need to REMOVE — find a sale that contains this product
        const targetSale = ventasEligibles.find(v =>
          v.productos.some((p: any) => p.productoId === desc.productoId || p.nombre === desc.productoAsociado)
        );
        if (targetSale) {
          const targetProduct = targetSale.productos.find(
            (p: any) => p.productoId === desc.productoId || p.nombre === desc.productoAsociado
          );
          correctedAcciones.push({
            action: 'remove_product',
            ventaId: targetSale.ventaId,
            ordenId: targetProduct?.ordenId,
            productoId: desc.productoId,
            nombreProducto: desc.productoAsociado,
            cantidadARemover: remaining,
            motivo: `El sistema registró ${remaining} unidades más que el consumo físico de ${desc.productoAsociado}. Se remueve del pedido ${targetSale.pedido || targetSale.ventaId} para cuadrar.`,
          });
        }
      }
    }

    // Mapear pedido para la vista UI
    correctedAcciones.forEach(acc => {
      if (acc.ventaId) {
        const found = ventasEligibles.find(v => v.ventaId === acc.ventaId);
        if (found) {
          acc.pedidoDisplay = found.pedido;
        } else {
          acc.pedidoDisplay = acc.ventaId;
        }
      }
    });

    const correctedPlan = {
      justificacionGeneral: plan.justificacionGeneral || 'Plan de cuadre generado y validado.',
      acciones: correctedAcciones,
    };

    console.log('[AutoCuadre] Plan CORREGIDO:', JSON.stringify(correctedPlan, null, 2));
    return correctedPlan;
  }

  async executeAutoCuadre(cajaId: string, planIA: any) {
    const caja = await this.prisma.aperturaCierreCaja.findUnique({ where: { IDcaja: cajaId } });
    if (!caja) throw new NotFoundException('Caja no encontrada');

    if (!planIA || !planIA.acciones || !Array.isArray(planIA.acciones)) {
      throw new BadRequestException('El plan de la IA no es válido.');
    }

    console.log('[ExecuteAutoCuadre] Iniciando ejecución con', planIA.acciones.length, 'acciones');
    console.log('[ExecuteAutoCuadre] Acciones recibidas:', JSON.stringify(planIA.acciones, null, 2));

    return this.prisma.$transaction(async (tx) => {
      let observacionesNuevas = "\n\n--- AUTO-CUADRE IA ---\n";
      let accionesEjecutadas = 0;
      
      for (let i = 0; i < planIA.acciones.length; i++) {
        const accion = planIA.acciones[i];
        console.log(`[ExecuteAutoCuadre] Acción ${i + 1}:`, JSON.stringify(accion));

        if (accion.action === 'remove_product' && accion.ordenId) {
          console.log(`[ExecuteAutoCuadre] → Buscando orden ${accion.ordenId}...`);
          const orden = await tx.orderventas.findUnique({
            where: { IDorderventas: accion.ordenId },
            include: { venta: true, producto: true }
          });

          if (orden) {
            console.log(`[ExecuteAutoCuadre] → Orden encontrada: ${orden.nombreProducto}, cant: ${orden.cantidad}`);
            const nuevaCantidad = Math.max(0, Number(orden.cantidad) - Number(accion.cantidadARemover));
            
            if (nuevaCantidad <= 0) {
              await tx.orderventas.delete({ where: { IDorderventas: accion.ordenId } });
              observacionesNuevas += `- Eliminado: ${orden.nombreProducto || 'Producto'} del Pedido #${orden.venta?.pedido}.\n`;
              console.log(`[ExecuteAutoCuadre] → Orden eliminada completamente`);
            } else {
              const unitPrice = Number(orden.precioTotal) / Number(orden.cantidad);
              const nuevoPrecioTotal = unitPrice * nuevaCantidad;
              
              await tx.orderventas.update({
                where: { IDorderventas: accion.ordenId },
                data: { 
                  cantidad: nuevaCantidad,
                  precioTotal: nuevoPrecioTotal
                }
              });
              observacionesNuevas += `- Reducido: ${orden.nombreProducto || 'Producto'} (-${accion.cantidadARemover}) del Pedido #${orden.venta?.pedido}.\n`;
              console.log(`[ExecuteAutoCuadre] → Cantidad reducida a ${nuevaCantidad}`);
            }

            // Recalculate totalInput of Venta
            if (orden.IDventas) {
              const restante = await tx.orderventas.findMany({ where: { IDventas: orden.IDventas } });
              const nuevoTotal = restante.reduce((acc, curr) => acc + Number(curr.precioTotal), 0);
              
              await tx.ventas.update({
                where: { IDventas: orden.IDventas },
                data: { totalInput: nuevoTotal, mensaje: '🤖 Modificado por Auto-Cuadre IA' }
              });
              console.log(`[ExecuteAutoCuadre] → Venta recalculada: $${nuevoTotal}`);
            }
            accionesEjecutadas++;
          } else {
            console.log(`[ExecuteAutoCuadre] → ⚠ Orden NO encontrada con ID: ${accion.ordenId}`);
          }
        } else if (accion.action === 'add_product' && accion.ventaId && accion.productoId) {
          console.log(`[ExecuteAutoCuadre] → ADD_PRODUCT: ventaId=${accion.ventaId}, productoId=${accion.productoId}, cantidad=${accion.cantidadAAnadir}`);
          
          // Verify the venta exists first
          const ventaExiste = await tx.ventas.findUnique({ where: { IDventas: accion.ventaId } });
          if (!ventaExiste) {
            console.log(`[ExecuteAutoCuadre] → ⚠ Venta NO encontrada con ID: ${accion.ventaId}`);
            continue;
          }
          console.log(`[ExecuteAutoCuadre] → Venta encontrada: pedido=${ventaExiste.pedido}, fecha=${ventaExiste.fechaYHora}`);

          // Verify if there is already an orderventas for this product in this sale
          const ordenExistente = await tx.orderventas.findFirst({
            where: { IDventas: accion.ventaId, productoId: accion.productoId }
          });

          if (ordenExistente) {
            console.log(`[ExecuteAutoCuadre] → Orden existente encontrada, cant actual: ${ordenExistente.cantidad}`);
            const unitPrice = Number(ordenExistente.precioTotal) / Number(ordenExistente.cantidad);
            const nuevaCantidad = Number(ordenExistente.cantidad) + Number(accion.cantidadAAnadir);
            const nuevoPrecioTotal = unitPrice * nuevaCantidad;
            
            await tx.orderventas.update({
              where: { IDorderventas: ordenExistente.IDorderventas },
              data: { cantidad: nuevaCantidad, precioTotal: nuevoPrecioTotal }
            });
            observacionesNuevas += `- Añadido: ${accion.nombreProducto} (+${accion.cantidadAAnadir}) al Pedido #${ventaExiste.pedido}.\n`;
            console.log(`[ExecuteAutoCuadre] → Cantidad actualizada a ${nuevaCantidad}, precio: $${nuevoPrecioTotal}`);
          } else {
            console.log(`[ExecuteAutoCuadre] → Producto NO existe en esta venta, creando nueva línea...`);
            // Find the product to get its price (productoId might be the product name if legacy configuration)
            const prod = await tx.productos.findFirst({
              where: {
                OR: [
                  { IDproductos: accion.productoId },
                  { nombre: accion.productoId },
                  { nombre: accion.nombreProducto }
                ]
              }
            });
            if (prod) {
              const unitPrice = Number(prod.precioUnitario || 0);
              const total = unitPrice * Number(accion.cantidadAAnadir);
              console.log(`[ExecuteAutoCuadre] → Producto encontrado: ${prod.nombre}, precio unitario: $${unitPrice}, total: $${total}`);
              const newId = `ac-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
              await tx.orderventas.create({
                data: {
                  IDventas: accion.ventaId,
                  productoId: prod.IDproductos,
                  nombreProducto: prod.nombre,
                  cantidad: Number(accion.cantidadAAnadir),
                  precioTotal: total,
                  IDorderventas: newId
                }
              });
              observacionesNuevas += `- Creado: ${accion.nombreProducto} (+${accion.cantidadAAnadir}) en Pedido #${ventaExiste.pedido}.\n`;
              console.log(`[ExecuteAutoCuadre] → Nueva línea creada con ID: ${newId}`);
            } else {
              console.log(`[ExecuteAutoCuadre] → ⚠ Producto NO encontrado con ID: ${accion.productoId}`);
            }
          }

          // Recalculate Venta total
          const restante = await tx.orderventas.findMany({ where: { IDventas: accion.ventaId } });
          const nuevoTotal = restante.reduce((acc, curr) => acc + Number(curr.precioTotal), 0);
          await tx.ventas.update({
            where: { IDventas: accion.ventaId },
            data: { totalInput: nuevoTotal, mensaje: '🤖 Modificado por Auto-Cuadre IA' }
          });
          console.log(`[ExecuteAutoCuadre] → Venta total recalculada: $${nuevoTotal}`);
          accionesEjecutadas++;
        } else if (accion.action === 'change_payment' && accion.ventaId) {
          const venta = await tx.ventas.findUnique({ where: { IDventas: accion.ventaId } });
          if (venta) {
            let updateData: any = { medioDePago: accion.method, mensaje: '🤖 Modificado por Auto-Cuadre IA' };
            
            if (accion.method === 'EFECTIVO Y OTROS') {
              updateData.efectivoRecibido = Number(accion.efectivoRecibido || 0);
              updateData.valorDeTransferencia = Number(accion.transferenciaRecibida || 0);
              updateData.banco = 'TRANSFERENCIA';
            } else if (accion.method === 'EFECTIVO') {
              updateData.efectivoRecibido = Number(venta.totalInput || 0);
              updateData.valorDeTransferencia = 0;
            } else if (['TRANSFERENCIA', 'NEQUI', 'DAVIPLATA', 'BANCOLOMBIA'].includes(accion.method)) {
              updateData.efectivoRecibido = 0;
              updateData.valorDeTransferencia = Number(venta.totalInput || 0);
            }
            
            await tx.ventas.update({
              where: { IDventas: accion.ventaId },
              data: updateData
            });
            observacionesNuevas += `- Pago Cambiado: Pedido #${venta.pedido} a ${accion.method}.\n`;
            accionesEjecutadas++;
          }
        } else {
          console.log(`[ExecuteAutoCuadre] → ⚠ ACCIÓN SALTADA: action=${accion.action}, ventaId=${accion.ventaId || 'FALTA'}, productoId=${accion.productoId || 'FALTA'}, ordenId=${accion.ordenId || 'FALTA'}`);
        }
      }

      console.log(`[ExecuteAutoCuadre] Total acciones ejecutadas: ${accionesEjecutadas} de ${planIA.acciones.length}`);

      await tx.aperturaCierreCaja.update({
        where: { IDcaja: cajaId },
        data: {
          observaciones: (caja.observaciones || '') + observacionesNuevas
        }
      });

      return { success: true, message: `Plan de Auto-Cuadre ejecutado: ${accionesEjecutadas} acciones aplicadas.` };
    });
  }

  async getVerificacionPendiente(id: string, user?: any) {
    const caja = await this.prisma.aperturaCierreCaja.findUnique({
      where: { IDcaja: id }
    });

    if (!caja) {
      throw new NotFoundException(`Caja con ID ${id} no encontrada`);
    }

    const insumos = await this.prisma.insumos.findMany({
      where: { cuadrarInsumos: true, estado: 'ACTIVO' }
    });

    const pendientes = insumos.map(insumo => {
      const conteos = (insumo.ultimosConteos as any[]) || [];
      const conteosDeEstaCaja = conteos.filter(c => c.cajaId === id);
      const ultimoConteo = conteosDeEstaCaja.length > 0 ? conteosDeEstaCaja[conteosDeEstaCaja.length - 1] : null;
      
      let verificado = false;
      if (ultimoConteo) {
        verificado = true;
      }

      return {
        id: insumo.IDalimentos,
        nombre: insumo.nombre,
        unidadDeMedida: insumo.unidades || 'und',
        disponibleEnSistema: Number(insumo.disponible) || 0,
        ultimoConteoAt: ultimoConteo?.fecha || null,
        conteoVerificado: verificado
      };
    });

    const pendientesSinVerificar = pendientes.filter(p => !p.conteoVerificado);
    
    const isAdmin = user?.rol === 'Admin app' || user?.rol === 'Admin negocio';
    const maxPosposiciones = isAdmin ? -1 : 5;
    const posposicionesRestantes = isAdmin ? -1 : Math.max(0, maxPosposiciones - (caja.contador || 0));

    return {
      pendientes,
      totalPendientes: pendientesSinVerificar.length,
      yaVerificado: pendientes.some(p => p.conteoVerificado),
      todasVerificadas: pendientesSinVerificar.length === 0,
      contadorPosposiciones: caja.contador || 0,
      posposicionesRestantes,
      puedePosponer: isAdmin || (posposicionesRestantes > 0 && pendientesSinVerificar.length > 0 && caja.cierre !== 'cerrada')
    };
  }

  async posponerVerificacion(id: string, user?: any) {
    const caja = await this.prisma.aperturaCierreCaja.findUnique({
      where: { IDcaja: id }
    });

    if (!caja) {
      throw new NotFoundException(`Caja con ID ${id} no encontrada`);
    }

    if (caja.cierre === 'cerrada') {
      throw new NotFoundException('No se puede posponer en una caja cerrada');
    }

    const isAdmin = user?.rol === 'Admin app' || user?.rol === 'Admin negocio';
    const maxPosposiciones = isAdmin ? -1 : 5;
    const contadorActual = caja.contador || 0;
    
    if (!isAdmin && contadorActual >= maxPosposiciones) {
      throw new BadRequestException(`Ya no puedes posponer más. Has alcanzado el límite de ${maxPosposiciones} veces. Debes hacer la verificación.`);
    }

    const insumos = await this.prisma.insumos.findMany({
      where: { cuadrarInsumos: true, estado: 'ACTIVO' }
    });

    const hoy = new Date();
    hoy.setHours(5, 0, 0, 0);
    if (new Date() < hoy) {
      hoy.setDate(hoy.getDate() - 1);
    }

    const pendientesSinVerificar = insumos.filter(insumo => {
      const conteos = (insumo.ultimosConteos as any[]) || [];
      const conteosDeEstaCaja = conteos.filter(c => c.cajaId === id);
      const ultimoConteo = conteosDeEstaCaja.length > 0 ? conteosDeEstaCaja[conteosDeEstaCaja.length - 1] : null;
      if (!ultimoConteo?.fecha) return true;
      const fechaConteo = new Date(ultimoConteo.fecha);
      return fechaConteo < hoy;
    });

    if (pendientesSinVerificar.length === 0) {
      throw new BadRequestException('No hay insumos pendientes por verificar');
    }

    const nuevoContador = contadorActual + 1;

    await this.prisma.aperturaCierreCaja.update({
      where: { IDcaja: id },
      data: { contador: nuevoContador }
    });

    this.appGateway.emitToCaja(SocketEvent.REFRESH_CAJA, {
      action: 'verificacion_pospuesta',
      cajaId: id,
      contador: nuevoContador
    });

    const restantes = isAdmin ? -1 : (maxPosposiciones - nuevoContador);

    return {
      success: true,
      message: `Verificación pospuesta. ${isAdmin ? 'Intentos ilimitados.' : restantes + ' posposiciones restantes.'}`,
      contadorPosposiciones: nuevoContador,
      posposicionesRestantes: restantes
    };
  }

  async registrarConteo(id: string, dto: { insumos: any[] }) {
    const caja = await this.prisma.aperturaCierreCaja.findUnique({
      where: { IDcaja: id }
    });

    if (!caja) {
      throw new NotFoundException(`Caja con ID ${id} no encontrada`);
    }

    if (caja.cierre === 'cerrada') {
      throw new NotFoundException('No se puede registrar conteo en una caja cerrada');
    }

    return this.prisma.$transaction(async (tx) => {
      for (const insumoConteo of dto.insumos) {
        const { idInsumo, cantContada, disponibleEnSistema } = insumoConteo;

        const insumo = await tx.insumos.findUnique({
          where: { IDalimentos: idInsumo }
        });

        if (!insumo) continue;

        const conteosActuales = (insumo.ultimosConteos as any[]) || [];
        const nuevoConteo = {
          fecha: new Date().toISOString(),
          cajaId: id,
          disponibleEnSistema: disponibleEnSistema,
          cantContada: cantContada,
          diferencia: cantContada - disponibleEnSistema
        };

        const MAX_CONTEOS = 30;
        const nuevosConteos = [...conteosActuales, nuevoConteo].slice(-MAX_CONTEOS);

        await tx.insumos.update({
          where: { IDalimentos: idInsumo },
          data: {
            ultimosConteos: nuevosConteos
          }
        });
      }

      this.appGateway.emitToCaja(SocketEvent.REFRESH_CAJA, {
        action: 'conteo_registrado',
        cajaId: id
      });

      this.appGateway.emitToRoom('insumos', SocketEvent.REFRESH_INSUMOS, {
        action: 'conteo_registrado',
        cajaId: id
      });

      return { success: true, message: 'Conteo registrado correctamente' };
    });
  }

  async eliminarConteo(cajaId: string, insumoId: string, conteoIndex: number) {
    const insumo = await this.prisma.insumos.findUnique({
      where: { IDalimentos: insumoId }
    });

    if (!insumo) {
      throw new NotFoundException(`Insumo con ID ${insumoId} no encontrado`);
    }

    let conteos = [];
    if (typeof insumo.ultimosConteos === 'string') {
      try { conteos = JSON.parse(insumo.ultimosConteos); } catch(e) { conteos = []; }
    } else {
      conteos = (insumo.ultimosConteos as any[]) || [];
    }
    
    if (conteoIndex < 0 || conteoIndex >= conteos.length) {
      throw new BadRequestException('Índice de conteo inválido');
    }

    const conteosFiltrados = conteos.filter((_: any, i: number) => i !== conteoIndex);

    await this.prisma.insumos.update({
      where: { IDalimentos: insumoId },
      data: { ultimosConteos: conteosFiltrados }
    });

    this.appGateway.emitToRoom('insumos', SocketEvent.REFRESH_INSUMOS, {
      action: 'conteo_eliminado',
      insumoId
    });

    return { success: true, message: 'Conteo eliminado correctamente' };
  }

  async editarConteo(cajaId: string, insumoId: string, conteoIndex: number, nuevaCantContada: number) {
    if (nuevaCantContada < 0) {
      throw new BadRequestException('La cantidad no puede ser negativa');
    }

    const insumo = await this.prisma.insumos.findUnique({
      where: { IDalimentos: insumoId }
    });

    if (!insumo) {
      throw new NotFoundException(`Insumo con ID ${insumoId} no encontrado`);
    }

    let conteos = [];
    if (typeof insumo.ultimosConteos === 'string') {
      try { conteos = JSON.parse(insumo.ultimosConteos); } catch(e) { conteos = []; }
    } else {
      conteos = (insumo.ultimosConteos as any[]) || [];
    }

    if (conteoIndex < 0 || conteoIndex >= conteos.length) {
      throw new BadRequestException('Índice de conteo inválido');
    }

    // Actualizar el conteo específico
    const conteo = conteos[conteoIndex];
    if (conteo.cajaId !== cajaId) {
      throw new BadRequestException('El conteo no pertenece a la caja especificada');
    }

    conteo.cantContada = nuevaCantContada;
    conteo.diferencia = nuevaCantContada - (conteo.disponibleEnSistema || 0);

    conteos[conteoIndex] = conteo;

    await this.prisma.insumos.update({
      where: { IDalimentos: insumoId },
      data: { ultimosConteos: conteos }
    });

    this.appGateway.emitToRoom('insumos', SocketEvent.REFRESH_INSUMOS, {
      action: 'conteo_actualizado',
      insumoId
    });

    return { success: true, message: 'Conteo actualizado correctamente', data: conteo };
  }

  async reabrirCaja(id: string) {
    const caja = await this.prisma.aperturaCierreCaja.findUnique({
      where: { IDcaja: id }
    });

    if (!caja) {
      throw new NotFoundException(`Caja con ID ${id} no encontrada`);
    }

    if (caja.cierre === 'abierta') {
      throw new BadRequestException('Esta caja ya está abierta');
    }

    const updatedCaja = await this.prisma.aperturaCierreCaja.update({
      where: { IDcaja: id },
      data: {
        cierre: 'abierta',
        fechaDeCierre: null,
        horaDeCierre: null,
        efectivoDeCierre: null,
      }
    });

    this.appGateway.emitToRoom('caja', SocketEvent.REFRESH_CAJA, {
      action: 'reabierta',
      cajaId: id
    });

    return {
      success: true,
      message: 'Caja reabierta correctamente',
      data: updatedCaja
    };
  }
}

