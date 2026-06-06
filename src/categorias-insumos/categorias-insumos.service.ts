import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCategoriaInsumoDto, UpdateCategoriaInsumoDto } from './dto/categorias-insumos.dto';

@Injectable()
export class CategoriasInsumosService {
  constructor(private readonly prisma: PrismaService) {}

  async create(createDto: CreateCategoriaInsumoDto) {
    const existeNombre = await this.prisma.categoriasInsumos.findFirst({
      where: { nombre: { equals: createDto.nombre, mode: 'insensitive' } },
    });

    if (existeNombre) {
      throw new ConflictException(`Ya existe una categoría de insumo con el nombre ${createDto.nombre}`);
    }

    return this.prisma.categoriasInsumos.create({
      data: {
        nombre: createDto.nombre,
        imagen: createDto.imagen,
      },
    });
  }

  async findAll() {
    return this.prisma.categoriasInsumos.findMany({
      orderBy: {
        nombre: 'asc',
      },
    });
  }

  async findOne(id: string) {
    const categoria = await this.prisma.categoriasInsumos.findUnique({
      where: { IDcategoriainsumos: id },
    });

    if (!categoria) {
      throw new NotFoundException(`Categoría de insumo con ID ${id} no encontrada`);
    }

    return categoria;
  }

  async update(id: string, updateDto: UpdateCategoriaInsumoDto) {
    await this.findOne(id); // Verifica si existe

    if (updateDto.nombre) {
      const existeNombre = await this.prisma.categoriasInsumos.findFirst({
        where: { 
          nombre: { equals: updateDto.nombre, mode: 'insensitive' },
          NOT: { IDcategoriainsumos: id }
        },
      });

      if (existeNombre) {
        throw new ConflictException(`Ya existe otra categoría de insumo con el nombre ${updateDto.nombre}`);
      }
    }

    return this.prisma.categoriasInsumos.update({
      where: { IDcategoriainsumos: id },
      data: {
        ...(updateDto.nombre && { nombre: updateDto.nombre }),
        ...(updateDto.imagen !== undefined && { imagen: updateDto.imagen }),
      },
    });
  }

  async remove(id: string) {
    await this.findOne(id); // Verifica si existe
    
    // Aquí podrías agregar validación para no eliminar si tiene insumos asociados
    // Por simplicidad de momento, procedemos a borrar.
    
    return this.prisma.categoriasInsumos.delete({
      where: { IDcategoriainsumos: id },
    });
  }
}
