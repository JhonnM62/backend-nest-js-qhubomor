import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateClienteDto, UpdateClienteDto, ClienteQueryDto } from './dto/cliente.dto';
import { Prisma } from '@prisma/client';

@Injectable()
export class ClientesService {
  constructor(private prisma: PrismaService) {}

  async create(createClienteDto: CreateClienteDto) {
    let finalId = createClienteDto.IDcliente;

    if (!finalId) {
      // Generar un ID aleatorio de 4 a 5 dígitos que no exista
      let isUnique = false;
      while (!isUnique) {
        finalId = Math.floor(1000 + Math.random() * 90000); // 1000 a 99999
        const exists = await this.prisma.clientes.findUnique({
          where: { IDcliente: finalId }
        });
        if (!exists) {
          isUnique = true;
        }
      }
    } else {
      // Verificar si el ID manual ya existe
      const exists = await this.prisma.clientes.findUnique({
        where: { IDcliente: finalId }
      });
      if (exists) {
        throw new NotFoundException(`El ID de cliente ${finalId} ya está en uso.`);
      }
    }

    const { cedula, ...rest } = createClienteDto;

    return this.prisma.clientes.create({
      data: {
        ...rest,
        cedula: cedula ? BigInt(cedula) : null,
        IDcliente: finalId,
        fecha_y_hora_creacion: new Date(),
      },
    });
  }

  async findAll(query: any) {
    const { page = 1, limit = 20, buscar, isActive } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.ClientesWhereInput = {};

    if (isActive !== undefined) {
      where.isActive = isActive;
    }

    if (buscar) {
      where.OR = [
        { nombre: { contains: buscar, mode: 'insensitive' } },
        { whatsapp: { contains: buscar, mode: 'insensitive' } },
      ];
      if (!isNaN(Number(buscar))) {
        where.OR.push({ cedula: { equals: BigInt(buscar) } });
        where.OR.push({ IDcliente: { equals: Number(buscar) } });
      }
    }

    const [data, total] = await Promise.all([
      this.prisma.clientes.findMany({
        where,
        skip,
        take: limit,
        orderBy: { IDcliente: 'desc' },
      }),
      this.prisma.clientes.count({ where }),
    ]);

    const formattedData = data.map(item => ({
      ...item,
      cedula: item.cedula ? Number(item.cedula) : null,
    }));

    return {
      data: formattedData,
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

  async findFidelidad(identificador: string) {
    const rawClean = identificador ? identificador.trim() : '';
    const clean = rawClean.replace(/^#/, '').trim();
    if (!clean) {
      throw new NotFoundException('Identificador de cliente no proporcionado');
    }

    const where: Prisma.ClientesWhereInput = {
      isActive: true,
      OR: [
        { whatsapp: { contains: clean } },
        { nombre: { contains: clean, mode: 'insensitive' } },
      ],
    };

    if (!isNaN(Number(clean))) {
      where.OR!.push({ cedula: { equals: BigInt(clean) } });
      where.OR!.push({ IDcliente: { equals: Number(clean) } });
    } else {
      where.OR!.push({ nombre: { contains: clean, mode: 'insensitive' } });
    }

    const cliente = await this.prisma.clientes.findFirst({
      where,
    });

    if (!cliente) {
      throw new NotFoundException(`Cliente no encontrado con identificador ${clean}`);
    }

    // Buscar ventas tanto por IDcliente (FK) como por texto (columna "Clente" / número de teléfono)
    const ventasOrConditions: Prisma.VentasWhereInput[] = [
      { clienteId: cliente.IDcliente },
      { cliente: String(cliente.IDcliente) },
    ];

    if (cliente.cedula) {
      ventasOrConditions.push({ cliente: cliente.cedula.toString() });
    }
    if (cliente.nombre) {
      ventasOrConditions.push({ cliente: cliente.nombre });
    }
    if (cliente.whatsapp) {
      ventasOrConditions.push({ cliente: cliente.whatsapp });
      const numOnly = cliente.whatsapp.replace(/\D/g, '');
      if (numOnly) {
        ventasOrConditions.push({ cliente: { contains: numOnly } });
      }
    }

    const ventas = await this.prisma.ventas.findMany({
      where: {
        OR: ventasOrConditions,
        deleteReason: null,
      },
      take: 10,
      orderBy: { fechaYHora: 'desc' },
      include: { ordenVentas: true },
    });

    const contador = cliente.contador ?? 0;
    const comprasTotales = Math.max(parseInt(cliente.compras || '0', 10) || 0, contador, ventas.length);

    return {
      IDcliente: cliente.IDcliente,
      nombre: cliente.nombre || 'Cliente VIP',
      cedula: cliente.cedula ? cliente.cedula.toString() : null,
      whatsapp: cliente.whatsapp || null,
      contador,
      comprasTotales,
      hito5: contador >= 5,
      hito10: contador >= 10,
      granizadoGratis: contador >= 10,
      sellosRestantesParaGranizado: Math.max(0, 10 - contador),
      ultimasVentas: ventas.map((v) => ({
        IDventas: v.IDventas,
        pedido: v.pedido || 'Pedido',
        totalInput: v.totalInput ? Number(v.totalInput) : 0,
        fechaYHora: v.fechaYHora ? v.fechaYHora.toISOString() : null,
        estado: v.estado,
        compras: v.compras,
        productos: (v.ordenVentas || []).map((o) => ({
          nombre: o.nombreProducto || 'Producto',
          cantidad: o.cantidad,
          precioTotal: o.precioTotal ? Number(o.precioTotal) : 0,
        })),
      })),
    };
  }

  async findOne(id: number) {
    const cliente = await this.prisma.clientes.findUnique({
      where: { IDcliente: id },
      include: { ventas: true }
    });

    if (!cliente) {
      throw new NotFoundException(`Cliente con ID ${id} no encontrado`);
    }

    return {
      ...cliente,
      cedula: cliente.cedula ? Number(cliente.cedula) : null,
    };
  }

  async update(id: number, updateClienteDto: UpdateClienteDto) {
    const cliente = await this.prisma.clientes.findUnique({
      where: { IDcliente: id },
    });

    if (!cliente) {
      throw new NotFoundException(`Cliente con ID ${id} no encontrado`);
    }

    const { cedula, ...rest } = updateClienteDto;

    const updated = await this.prisma.clientes.update({
      where: { IDcliente: id },
      data: {
        ...rest,
        ...(cedula !== undefined ? { cedula: cedula ? BigInt(cedula) : null } : {}),
        fecha_y_hora_actualizacion: new Date(),
      },
    });

    return {
      ...updated,
      cedula: updated.cedula ? Number(updated.cedula) : null,
    };
  }

  async remove(id: number) {
    const cliente = await this.prisma.clientes.findUnique({
      where: { IDcliente: id },
    });

    if (!cliente) {
      throw new NotFoundException(`Cliente con ID ${id} no encontrado`);
    }

    return this.prisma.clientes.update({
      where: { IDcliente: id },
      data: { isActive: false, fecha_y_hora_actualizacion: new Date() }
    });
  }
}
