import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateClienteDto, UpdateClienteDto, ClienteQueryDto } from './dto/cliente.dto';
import { Prisma } from '@prisma/client';

@Injectable()
export class ClientesService {
  constructor(private prisma: PrismaService) {}

  async create(createClienteDto: CreateClienteDto) {
    return this.prisma.clientes.create({
      data: {
        ...createClienteDto,
        fecha_y_hora_creacion: new Date(),
      },
    });
  }

  async findAll(query: ClienteQueryDto) {
    const { page = 1, limit = 20, buscar } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.ClientesWhereInput = {};

    if (buscar) {
      where.OR = [
        { nombre: { contains: buscar, mode: 'insensitive' } },
        { cedula: { equals: isNaN(Number(buscar)) ? undefined : Number(buscar) } },
        { whatsapp: { contains: buscar, mode: 'insensitive' } },
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.clientes.findMany({
        where,
        skip,
        take: limit,
        orderBy: { fecha_y_hora_creacion: 'desc' },
      }),
      this.prisma.clientes.count({ where }),
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

  async findOne(id: number) {
    const cliente = await this.prisma.clientes.findUnique({
      where: { IDcliente: id },
    });

    if (!cliente) {
      throw new NotFoundException(`Cliente con ID ${id} no encontrado`);
    }

    return cliente;
  }

  async update(id: number, updateClienteDto: UpdateClienteDto) {
    const cliente = await this.prisma.clientes.findUnique({
      where: { IDcliente: id },
    });

    if (!cliente) {
      throw new NotFoundException(`Cliente con ID ${id} no encontrado`);
    }

    return this.prisma.clientes.update({
      where: { IDcliente: id },
      data: {
        ...updateClienteDto,
        fecha_y_hora_actualizacion: new Date(),
      },
    });
  }

  async remove(id: number) {
    const cliente = await this.prisma.clientes.findUnique({
      where: { IDcliente: id },
    });

    if (!cliente) {
      throw new NotFoundException(`Cliente con ID ${id} no encontrado`);
    }

    return this.prisma.clientes.delete({
      where: { IDcliente: id },
    });
  }
}
