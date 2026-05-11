import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateGastoDto, UpdateGastoDto, GastosQueryDto } from './dto/gasto.dto';
import { Prisma } from '@prisma/client';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class GastosService {
  constructor(
    private prisma: PrismaService,
    private notificationsService: NotificationsService
  ) {}

  async create(createGastoDto: CreateGastoDto) {
    const gasto = await this.prisma.gastos.create({
      data: {
        ...createGastoDto,
        fechaYHora: new Date(),
        fecha: new Date(),
      },
    });

    this.notificationsService.sendNotification(
      'GASTO_CREATED',
      'Nuevo Gasto Registrado',
      `Se ha registrado un gasto por $${gasto.valor} (${gasto.concepto})`,
      { gastoId: gasto.IDgastos }
    );

    return gasto;
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
    });
  }

  async remove(id: string) {
    const gasto = await this.prisma.gastos.findUnique({
      where: { IDgastos: id },
    });

    if (!gasto) {
      throw new NotFoundException(`Gasto con ID ${id} no encontrado`);
    }

    await this.prisma.gastos.delete({
      where: { IDgastos: id },
    });

    this.notificationsService.sendNotification(
      'GASTO_DELETED',
      'Gasto Eliminado',
      `Se ha eliminado el gasto de $${gasto.valor} (${gasto.concepto})`,
      { gastoId: id }
    );

    return gasto;
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
