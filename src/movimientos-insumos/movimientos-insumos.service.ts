import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { AppGateway } from '../websocket/app.gateway';
import { SocketEvent } from '../websocket/types/socket.types';
import { AbrirPaqueteDto, DescuentoProduccionDto, EntradaLibreDto } from './dto/movimientos.dto';

@Injectable()
export class MovimientosInsumosService {
  constructor(
    private prisma: PrismaService,
    private appGateway: AppGateway,
  ) {}

  async findAll(query: any) {
    // Implementar filtros y paginación si se requieren
    return this.prisma.movimientosInsumos.findMany({
      orderBy: { fechaYHora: 'desc' },
      include: { insumo: { select: { nombre: true, unidades: true } } },
      take: 100, // Limit default
    });
  }

  async abrirPaquete(dto: AbrirPaqueteDto, usuario: string) {
    const { insumoId, cajaId, cantidadReal, syncGlobalStock = true } = dto;

    const insumo = await this.prisma.insumos.findUnique({
      where: { IDalimentos: insumoId },
    });

    if (!insumo) {
      throw new NotFoundException(`Insumo con ID ${insumoId} no encontrado`);
    }

    if (!insumo.cantidadPorPaquete || !insumo.paquetesEnBodega || insumo.paquetesEnBodega <= 0) {
      throw new BadRequestException('El insumo no tiene paquetes configurados o en bodega');
    }

    const cantidadAnterior = insumo.cantidad || 0;
    const diferencia = cantidadReal - insumo.cantidadPorPaquete;
    
    let nuevoStock = cantidadAnterior;
    let pendiente = null;
    let nuevoPrecio = insumo.precio;
    let insumoActualizado = null;

    if (syncGlobalStock) {
      if (insumo.ajusteRequiereAprobacion && diferencia !== 0) {
        pendiente = {
          cantidadReportada: cantidadReal,
          cantidadTeorica: insumo.cantidadPorPaquete,
          delta: diferencia,
          motivo: 'Diferencia en apertura de paquete',
          fechaYHora: new Date(),
          usuario,
        };
      } else {
        nuevoStock += diferencia;

        if (diferencia !== 0 && insumo.precio && insumo.cantidadPorPaquete) {
          const precioActual = Number(insumo.precio || 0);
          const costoPaquete = insumo.cantidadPorPaquete * precioActual;
          if (cantidadReal > 0) {
            nuevoPrecio = (costoPaquete / cantidadReal) as any;
          }
        }
      }

      insumoActualizado = await this.prisma.insumos.update({
        where: { IDalimentos: insumoId },
        data: {
          cantidad: nuevoStock,
          disponible: String(nuevoStock),
          precio: nuevoPrecio,
          total: Number(nuevoPrecio || 0) * nuevoStock,
          paquetesEnBodega: insumo.paquetesEnBodega - 1,
          ultimoAjustePendiente: pendiente ? (pendiente as any) : Prisma.DbNull,
          updatedAt: new Date(),
        }
      });
      
      // Actualizar el último registro de entrada si hubo un cambio de precio
      if (diferencia !== 0 && !pendiente && nuevoPrecio !== insumo.precio) {
        const ultimaOrden = await this.prisma.orderinventario.findFirst({
          where: {
            OR: [{ nombreDelAlimento: insumoId }, { nombreDelAlimento: insumo.nombre }],
            inventario: {
              tipo: { contains: 'ENTRADA', mode: 'insensitive' }
            },
            seCompro: 'Si'
          },
          orderBy: { fechaYHora: 'desc' }
        });
        
        if (ultimaOrden) {
          await this.prisma.orderinventario.update({
            where: { IDorderinventario: ultimaOrden.IDorderinventario },
            data: {
              precioActual: nuevoPrecio,
              precio: nuevoPrecio,
              subtotal: Number(ultimaOrden.cantidad || 0) * Number(nuevoPrecio),
              cantInsumos: cantidadReal
            }
          });
        }
      }
    }

    // Registrar el movimiento
    await this.prisma.movimientosInsumos.create({
      data: {
        IDinsumo: insumoId,
        tipo: syncGlobalStock ? 'apertura_paquete' : 'apertura_paquete_local',
        cantidadDelta: cantidadReal,
        cantidadAntes: cantidadAnterior,
        cantidadDespues: nuevoStock,
        usuario,
        cajaId,
        observacion: syncGlobalStock 
          ? (diferencia !== 0 ? `Abrió paquete (Teórico: ${insumo.cantidadPorPaquete}, Real: ${cantidadReal})` : `Abrió paquete (Completo)`)
          : `Abrió paquete en caja sin afectar stock global (Real: ${cantidadReal})`,
      }
    });

    if (syncGlobalStock && insumoActualizado) {
      this.appGateway.emitToInsumos(SocketEvent.REFRESH_INSUMOS, { action: 'update', data: insumoActualizado });
    }

    return {
      success: true,
      message: syncGlobalStock ? 'Paquete abierto y stock actualizado' : 'Paquete abierto exitosamente',
      data: insumoActualizado,
    };
  }

  async descuentoProduccion(dto: DescuentoProduccionDto, usuario: string) {
    const { insumoId, cajaId, cantidadDescontada, observacion } = dto;

    const insumo = await this.prisma.insumos.findUnique({
      where: { IDalimentos: insumoId },
    });

    if (!insumo) {
      throw new NotFoundException(`Insumo con ID ${insumoId} no encontrado`);
    }

    const cantidadAnterior = insumo.cantidad || 0;
    const nuevoStock = cantidadAnterior - cantidadDescontada;

    const insumoActualizado = await this.prisma.insumos.update({
      where: { IDalimentos: insumoId },
      data: {
        cantidad: nuevoStock,
        disponible: String(nuevoStock),
        updatedAt: new Date(),
      }
    });

    // Registrar el movimiento
    await this.prisma.movimientosInsumos.create({
      data: {
        IDinsumo: insumoId,
        tipo: 'descuento_produccion',
        cantidadDelta: -cantidadDescontada,
        cantidadAntes: cantidadAnterior,
        cantidadDespues: nuevoStock,
        usuario,
        cajaId,
        observacion: observacion || 'Descuento manual (botón -)',
      }
    });

    this.appGateway.emitToInsumos(SocketEvent.REFRESH_INSUMOS, { action: 'update', data: insumoActualizado });

    return {
      success: true,
      message: 'Stock deducido correctamente',
      data: insumoActualizado,
    };
  }

  async entradaLibre(dto: EntradaLibreDto, usuario: string) {
    const { insumoId, cajaId, cantidadAgregada, observacion } = dto;

    const insumo = await this.prisma.insumos.findUnique({
      where: { IDalimentos: insumoId },
    });

    if (!insumo) {
      throw new NotFoundException(`Insumo con ID ${insumoId} no encontrado`);
    }

    const cantidadAnterior = insumo.cantidad || 0;
    const nuevoStock = cantidadAnterior + cantidadAgregada;

    let nuevosPaquetes = insumo.paquetesEnBodega || 0;
    if (insumo.cantidadPorPaquete && insumo.cantidadPorPaquete > 0) {
      // Calculate how many packages this new quantity corresponds to
      // For instance, if they add exactly the package size, that's +1 package.
      const addedPackages = Math.floor(cantidadAgregada / insumo.cantidadPorPaquete);
      nuevosPaquetes += addedPackages;
    }

    const insumoActualizado = await this.prisma.insumos.update({
      where: { IDalimentos: insumoId },
      data: {
        cantidad: nuevoStock,
        disponible: String(nuevoStock),
        paquetesEnBodega: nuevosPaquetes,
        updatedAt: new Date(),
      }
    });

    // Registrar el movimiento
    await this.prisma.movimientosInsumos.create({
      data: {
        IDinsumo: insumoId,
        tipo: 'entrada_libre',
        cantidadDelta: cantidadAgregada,
        cantidadAntes: cantidadAnterior,
        cantidadDespues: nuevoStock,
        usuario,
        cajaId,
        observacion: observacion || 'Entrada manual (botón +)',
      }
    });

    this.appGateway.emitToInsumos(SocketEvent.REFRESH_INSUMOS, { action: 'update', data: insumoActualizado });

    return {
      success: true,
      message: 'Stock agregado correctamente',
      data: insumoActualizado,
    };
  }
}
