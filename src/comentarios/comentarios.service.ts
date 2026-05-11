import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateComentarioDto, UpdateComentarioDto } from './dto/comentario.dto';

@Injectable()
export class ComentariosService {
  constructor(private prisma: PrismaService) {}

  async findAll() {
    return this.prisma.comentarios.findMany({
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const comentario = await this.prisma.comentarios.findUnique({
      where: { ID: id },
    });
    if (!comentario) throw new NotFoundException(`Comentario con ID ${id} no encontrado`);
    return comentario;
  }

  async create(data: CreateComentarioDto) {
    return this.prisma.comentarios.create({
      data: {
        comentarios: data.comentarios,
        tipo: data.tipo,
        precio: data.precio,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
  }

  async update(id: string, data: UpdateComentarioDto) {
    await this.findOne(id);
    return this.prisma.comentarios.update({
      where: { ID: id },
      data: {
        ...data,
        updatedAt: new Date(),
      },
    });
  }

  async remove(id: string) {
    await this.findOne(id);
    return this.prisma.comentarios.delete({
      where: { ID: id },
    });
  }
}
