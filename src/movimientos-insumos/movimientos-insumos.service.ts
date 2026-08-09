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
    const { insumoId, cajaId, cantidadReal } = dto;

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
    
    // Si requiere aprobación y hay diferencia (faltante o sobrante), queda pendiente.
    // Si no requiere, se aprueba automáticamente sumando al stock actual.
    // OJO: Si sumamos al stock, sumamos `cantidadReal`.

    let nuevoStock = cantidadAnterior;
    let pendiente = null;

    if (insumo.ajusteRequiereAprobacion && diferencia !== 0) {
      // Queda pendiente el ajuste de la diferencia
      pendiente = {
        cantidadReportada: cantidadReal,
        cantidadTeorica: insumo.cantidadPorPaquete,
        delta: diferencia,
        motivo: 'Diferencia en apertura de paquete',
        fechaYHora: new Date(),
        usuario,
      };
      // El nuevo stock solo suma lo teórico si la política es esperar a aprobar
      // O podemos sumar lo real y el ajuste es para "alertar".
      // Según diseño: si requiere aprobación, el stock global NO asume la diferencia hasta aprobar.
      // Así que sumamos la cantidadPorPaquete (el teórico) al stock, y dejamos la diferencia pendiente.
      nuevoStock += insumo.cantidadPorPaquete;
    } else {
      // Automático: sumamos la cantidad real al stock global
      nuevoStock += cantidadReal;
    }

    const insumoActualizado = await this.prisma.insumos.update({
      where: { IDalimentos: insumoId },
      data: {
        cantidad: nuevoStock,
        paquetesEnBodega: insumo.paquetesEnBodega - 1, // Descontamos 1 paquete
        ultimoAjustePendiente: pendiente ? (pendiente as any) : Prisma.DbNull,
        updatedAt: new Date(),
      }
    });

    // Registrar el movimiento
    await this.prisma.movimientosInsumos.create({
      data: {
        IDinsumo: insumoId,
        tipo: 'apertura_paquete',
        cantidadDelta: cantidadReal,
        cantidadAntes: cantidadAnterior,
        cantidadDespues: nuevoStock,
        usuario,
        cajaId,
        observacion: diferencia !== 0 ? `Abrió paquete (Teórico: ${insumo.cantidadPorPaquete}, Real: ${cantidadReal})` : `Abrió paquete (Completo)`,
      }
    });

    this.appGateway.emitToInsumos(SocketEvent.REFRESH_INSUMOS, { action: 'update', data: insumoActualizado });

    return {
      success: true,
      message: 'Paquete abierto y stock actualizado',
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
