import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateProveedoreDto, UpdateProveedoreDto, ProveedorQueryDto } from './dto/proveedore.dto';
import { Prisma } from '@prisma/client';

@Injectable()
export class ProveedoresService {
  constructor(private prisma: PrismaService) {}

  async create(createProveedoreDto: CreateProveedoreDto) {
    return this.prisma.proveedores.create({
      data: createProveedoreDto,
    });
  }

  async findAll(query: ProveedorQueryDto) {
    const { page = 1, limit = 20, buscar } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.ProveedoresWhereInput = {};

    if (buscar) {
      where.OR = [
        { nombre: { contains: buscar, mode: 'insensitive' } },
        { telefono: { contains: buscar, mode: 'insensitive' } },
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.proveedores.findMany({
        where,
        skip,
        take: limit,
        orderBy: { nombre: 'asc' },
        include: {
          ordenInventario: true,
        },
      }),
      this.prisma.proveedores.count({ where }),
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
    const proveedore = await this.prisma.proveedores.findUnique({
      where: { IDprovedor: id },
      include: {
        ordenInventario: true,
      },
    });

    if (!proveedore) {
      throw new NotFoundException(`Proveedor con ID ${id} no encontrado`);
    }

    return proveedore;
  }

  async update(id: string, updateProveedoreDto: UpdateProveedoreDto) {
    const proveedore = await this.prisma.proveedores.findUnique({
      where: { IDprovedor: id },
    });

    if (!proveedore) {
      throw new NotFoundException(`Proveedor con ID ${id} no encontrado`);
    }

    return this.prisma.proveedores.update({
      where: { IDprovedor: id },
      data: updateProveedoreDto,
    });
  }

  async remove(id: string) {
    const proveedore = await this.prisma.proveedores.findUnique({
      where: { IDprovedor: id },
    });

    if (!proveedore) {
      throw new NotFoundException(`Proveedor con ID ${id} no encontrado`);
    }

    return this.prisma.proveedores.delete({
      where: { IDprovedor: id },
    });
  }
}
