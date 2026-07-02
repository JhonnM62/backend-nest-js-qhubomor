import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateGastoDto, UpdateGastoDto, GastosQueryDto } from './dto/gasto.dto';
import { Prisma } from '@prisma/client';
import { NotificationsService } from '../notifications/notifications.service';
import { AppGateway } from '../websocket/app.gateway';
import { SocketEvent } from '../websocket/types/socket.types';

@Injectable()
export class GastosService {
  constructor(
    private prisma: PrismaService,
    private notificationsService: NotificationsService,
    private appGateway: AppGateway,
  ) {}

  async create(createGastoDto: CreateGastoDto) {
    const customDate = createGastoDto.fecha ? new Date(createGastoDto.fecha) : new Date();
    // Remover `fecha` del DTO para no pisarlo como string y ponerlo bien tipado
    const { fecha, ...restDto } = createGastoDto;

    const gasto = await this.prisma.gastos.create({
      data: {
        ...restDto,
        fechaYHora: customDate,
        fecha: customDate,
      },
    });

    this.notificationsService.sendNotification(
      'GASTO_CREATED',
      'Nuevo Gasto Registrado',
      `Se ha registrado un gasto por $${gasto.valor} (${gasto.concepto})`,
      { gastoId: gasto.IDgastos }
    );

    this.appGateway.emitToGastos(SocketEvent.REFRESH_GASTOS, { action: 'create', gasto });

    return gasto;
  }

  async createBulk(dtos: CreateGastoDto[]) {
    const now = new Date();
    const dataToInsert = dtos.map(dto => ({
      ...dto,
      fechaYHora: now,
      fecha: now,
    }));

    // Use transaction to ensure all or nothing
    await this.prisma.$transaction(
      dataToInsert.map(data => this.prisma.gastos.create({ data }))
    );

    const totalGastos = dtos.length;
    const totalValor = dtos.reduce((sum, dto) => sum + (dto.valor || 0), 0);

    this.notificationsService.sendNotification(
      'GASTOS_BULK_CREATED',
      'Carga Masiva de Gastos',
      `Se han registrado ${totalGastos} gastos por un total de $${totalValor.toLocaleString('es-CO')}`
    );

    this.appGateway.emitToGastos(SocketEvent.REFRESH_GASTOS, { action: 'bulk_create', count: totalGastos });

    return { created: totalGastos };
  }

  async findAll(query: GastosQueryDto) {
    const { page = 1, limit = 20, fechaDesde, fechaHasta, medioDePago, tipo } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.GastosWhereInput = {};

    if (medioDePago) {
      where.medioDePago = medioDePago;
    }
    
    if (tipo) {
      where.tipo = tipo;
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

    const [data, total] = await Promise.all([
      this.prisma.gastos.findMany({
        where,
        skip,
        take: limit,
        orderBy: { fechaYHora: 'desc' },
      }),
      this.prisma.gastos.count({ where }),
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
    const gasto = await this.prisma.gastos.findUnique({
      where: { IDgastos: id },
    });

    if (!gasto) {
      throw new NotFoundException(`Gasto con ID ${id} no encontrado`);
    }

    return gasto;
  }

  async update(id: string, updateGastoDto: UpdateGastoDto) {
    const gasto = await this.prisma.gastos.findUnique({
      where: { IDgastos: id },
    });

    if (!gasto) {
      throw new NotFoundException(`Gasto con ID ${id} no encontrado`);
    }

    return this.prisma.gastos.update({
      where: { IDgastos: id },
      data: updateGastoDto,
    }).then(updated => {
      this.appGateway.emitToGastos(SocketEvent.REFRESH_GASTOS, { action: 'update', gasto: updated });
      return updated;
    });
  }

  async remove(id: string) {
    const gasto = await this.prisma.gastos.findUnique({
      where: { IDgastos: id },
    });

    if (!gasto) {
      throw new NotFoundException(`Gasto con ID ${id} no encontrado`);
    }

    const deleted = await this.prisma.gastos.delete({
      where: { IDgastos: id },
    });

    this.notificationsService.sendNotification(
      'GASTO_DELETED',
      'Gasto Eliminado',
      `Se ha eliminado el gasto de $${gasto.valor} (${gasto.concepto})`,
      { gastoId: id }
    );

    this.appGateway.emitToGastos(SocketEvent.REFRESH_GASTOS, { action: 'delete', gastoId: id });

    return deleted;
  }

  async getTotalGastos(fechaDesde: Date, fechaHasta: Date) {
    const result = await this.prisma.gastos.aggregate({
      where: {
        fecha: {
          gte: fechaDesde,
          lte: fechaHasta,
        },
      },
      _sum: {
        valor: true,
      },
    });

    return { total: result._sum.valor || 0 };
  }
}
