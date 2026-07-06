import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCargoDto, UpdateCargoDto, CreateExcepcionHorarioDto } from './dto/cargo.dto';

@Injectable()
export class CargosService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreateCargoDto) {
    const existing = await this.prisma.cargosEmpleado.findFirst({
      where: { nombre: { equals: dto.nombre, mode: 'insensitive' } },
    });
    if (existing) {
      throw new BadRequestException(`Ya existe un cargo con el nombre "${dto.nombre}"`);
    }

    const cargo = await this.prisma.cargosEmpleado.create({ data: dto as any });
    return { success: true, data: cargo };
  }

  async findAll() {
    const cargos = await this.prisma.cargosEmpleado.findMany({
      orderBy: { nombre: 'asc' },
      include: { _count: { select: { usuarios: true } } },
    });
    return { success: true, data: cargos };
  }

  async findOne(id: string) {
    const cargo = await this.prisma.cargosEmpleado.findUnique({
      where: { IDcargo: id },
      include: { _count: { select: { usuarios: true } } },
    });
    if (!cargo) throw new NotFoundException(`Cargo con ID ${id} no encontrado`);
    return cargo;
  }

  async update(id: string, dto: UpdateCargoDto) {
    await this.findOne(id);

    if (dto.nombre) {
      const existing = await this.prisma.cargosEmpleado.findFirst({
        where: { nombre: { equals: dto.nombre, mode: 'insensitive' }, NOT: { IDcargo: id } },
      });
      if (existing) {
        throw new BadRequestException(`Ya existe un cargo con el nombre "${dto.nombre}"`);
      }
    }

    const updated = await this.prisma.cargosEmpleado.update({
      where: { IDcargo: id },
      data: dto as any,
    });
    return { success: true, data: updated };
  }

  async remove(id: string) {
    const cargo = await this.findOne(id);
    if ((cargo as any)._count?.usuarios > 0) {
      throw new BadRequestException('No se puede eliminar un cargo que tiene empleados asignados. Reasigna los empleados primero.');
    }
    await this.prisma.cargosEmpleado.delete({ where: { IDcargo: id } });
    return { success: true, message: 'Cargo eliminado correctamente' };
  }

  // EXCEPCIONES HORARIO
  async createExcepcion(dto: CreateExcepcionHorarioDto) {
    const cargo = await this.prisma.cargosEmpleado.findUnique({ where: { IDcargo: dto.cargoId } });
    if (!cargo) throw new NotFoundException('Cargo no encontrado');

    const fecha = new Date(dto.fecha);
    
    // Check if exception already exists
    const existing = await this.prisma.excepcionHorarioCargo.findUnique({
      where: {
        cargoId_fecha: {
          cargoId: dto.cargoId,
          fecha,
        }
      }
    });

    if (existing) {
      // Update it
      const updated = await this.prisma.excepcionHorarioCargo.update({
        where: { id: existing.id },
        data: {
          nombre: dto.nombre,
          tarifa: dto.tarifa,
          horaEntrada: dto.horaEntrada,
          horaSalida: dto.horaSalida,
        }
      });
      return { success: true, data: updated, message: 'Excepción de horario actualizada' };
    } else {
      // Create new
      const created = await this.prisma.excepcionHorarioCargo.create({
        data: {
          cargoId: dto.cargoId,
          fecha,
          nombre: dto.nombre,
          tarifa: dto.tarifa,
          horaEntrada: dto.horaEntrada,
          horaSalida: dto.horaSalida,
        }
      });
      return { success: true, data: created, message: 'Excepción de horario creada' };
    }
  }

  async getExcepcionesPorCargo(cargoId: string) {
    // Only future or today's exceptions? Or all? Let's return from the last 7 days and future.
    const dateLimit = new Date();
    dateLimit.setDate(dateLimit.getDate() - 7);

    const excepciones = await this.prisma.excepcionHorarioCargo.findMany({
      where: {
        cargoId,
        fecha: {
          gte: dateLimit
        }
      },
      orderBy: { fecha: 'asc' }
    });
    return { success: true, data: excepciones };
  }

  async removeExcepcion(id: string) {
    try {
      await this.prisma.excepcionHorarioCargo.delete({ where: { id } });
      return { success: true, message: 'Excepción eliminada correctamente' };
    } catch (e) {
      throw new BadRequestException('La excepción no existe');
    }
  }
}
