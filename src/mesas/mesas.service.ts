import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateMesaDto } from './dto/create-mesa.dto';
import { UpdateMesaDto } from './dto/update-mesa.dto';

@Injectable()
export class MesasService {
  constructor(private prisma: PrismaService) {}

  async create(createMesaDto: CreateMesaDto) {
    return this.prisma.mesas.create({
      data: {
        nombre: createMesaDto.nombre,
      },
    });
  }

  async findAll() {
    return this.prisma.mesas.findMany({
      orderBy: { nombre: 'asc' },
    });
  }

  async findOne(id: string) {
    const mesa = await this.prisma.mesas.findUnique({
      where: { IdMesas: id },
    });
    
    if (!mesa) {
      throw new NotFoundException(`Mesa con ID ${id} no encontrada`);
    }
    
    return mesa;
  }

  async update(id: string, updateMesaDto: UpdateMesaDto) {
    await this.findOne(id); // Verifica si existe
    
    return this.prisma.mesas.update({
      where: { IdMesas: id },
      data: updateMesaDto,
    });
  }

  async remove(id: string) {
    await this.findOne(id); // Verifica si existe
    
    return this.prisma.mesas.delete({
      where: { IdMesas: id },
    });
  }
}
