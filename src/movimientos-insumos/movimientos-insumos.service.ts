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
    const { insumoId, cajaId, cantidadReal, syncGlobalStock = true, cantidadDePaquetes = 1 } = dto;

    const insumo = await this.prisma.insumos.findUnique({
      where: { IDalimentos: insumoId },
    });

    if (!insumo) {
      throw new NotFoundException(`Insumo con ID ${insumoId} no encontrado`);
    }

    if (!insumo.cantidadPorPaquete || !insumo.paquetesEnBodega || insumo.paquetesEnBodega < cantidadDePaquetes) {
      throw new BadRequestException('El insumo no tiene paquetes configurados o suficientes en bodega para esta apertura');
    }

    const cantidadAnterior = Number(insumo.disponible) || insumo.cantidad || 0;
    const teorico = insumo.cantidadPorPaquete * cantidadDePaquetes;
    const diferencia = cantidadReal - teorico;
    
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

        // No recalculamos el costo promedio (precio) durante las discrepancias de apertura,
        // ya que la merma no debe inflar el costo unitario afectando el costeo de la receta.

      }

      insumoActualizado = await this.prisma.insumos.update({
        where: { IDalimentos: insumoId },
        data: {
          cantidad: nuevoStock,
          disponible: String(nuevoStock),
          precio: nuevoPrecio,
          total: Number(nuevoPrecio || 0) * nuevoStock,
          paquetesEnBodega: insumo.paquetesEnBodega - cantidadDePaquetes,
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
          ? (diferencia !== 0 ? `Abrió ${cantidadDePaquetes} paquete(s) (Teórico: ${teorico}, Real: ${cantidadReal})` : `Abrió ${cantidadDePaquetes} paquete(s) (Completo)`)
          : `Abrió ${cantidadDePaquetes} paquete(s) en caja sin afectar stock global (Real: ${cantidadReal})`,
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

    const cantidadAnterior = Number(insumo.disponible) || insumo.cantidad || 0;
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
    const { insumoId, cajaId, cantidadAgregada, cantidadTeorica, observacion, syncGlobalStock = true } = dto as any;

    const insumo = await this.prisma.insumos.findUnique({
      where: { IDalimentos: insumoId },
    });

    if (!insumo) {
      throw new NotFoundException(`Insumo con ID ${insumoId} no encontrado`);
    }

    const cantidadAnterior = Number(insumo.disponible) || insumo.cantidad || 0;
    
    // Si no se envía cantidadTeorica o es 0, asumimos que es un "Ingreso Nuevo" (diferencia = toda la cantidadAgregada)
    const teorico = cantidadTeorica || 0;
    const diferencia = cantidadAgregada - teorico;
    const nuevoStock = cantidadAnterior + diferencia;

    let nuevosPaquetes = insumo.paquetesEnBodega || 0;
    // Si hay un cambio en el stock global, estimamos si impacta en los paquetes sueltos
    if (diferencia !== 0 && insumo.cantidadPorPaquete && insumo.cantidadPorPaquete > 0) {
      const addedPackages = Math.floor(diferencia / insumo.cantidadPorPaquete);
      nuevosPaquetes = Math.max(0, nuevosPaquetes + addedPackages);
    }

    let insumoActualizado = insumo;

    if (syncGlobalStock && diferencia !== 0) {
      insumoActualizado = await this.prisma.insumos.update({
        where: { IDalimentos: insumoId },
        data: {
          cantidad: nuevoStock,
          disponible: String(nuevoStock),
          paquetesEnBodega: nuevosPaquetes,
          updatedAt: new Date(),
        }
      });
    }

    // Registrar el movimiento
    await this.prisma.movimientosInsumos.create({
      data: {
        IDinsumo: insumoId,
        tipo: syncGlobalStock ? 'entrada_libre' : 'entrada_libre_local',
        cantidadDelta: syncGlobalStock ? diferencia : cantidadAgregada,
        cantidadAntes: cantidadAnterior,
        cantidadDespues: syncGlobalStock ? nuevoStock : cantidadAnterior,
        usuario,
        cajaId,
        observacion: syncGlobalStock 
          ? (observacion || (teorico > 0 ? `Ajuste inteligente (Teórico: ${teorico}, Real: ${cantidadAgregada})` : 'Entrada libre (Nuevo Ingreso)'))
          : `Traslado a caja sin afectar stock global (Real: ${cantidadAgregada})`,
      }
    });

    if (syncGlobalStock && diferencia !== 0) {
      this.appGateway.emitToInsumos(SocketEvent.REFRESH_INSUMOS, { action: 'update', data: insumoActualizado });
    }

    return {
      success: true,
      message: syncGlobalStock ? 'Stock ajustado correctamente' : 'Stock trasladado a caja sin modificar stock global',
      data: insumoActualizado,
    };
  }
}
