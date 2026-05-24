import { Injectable, NotFoundException, Inject } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCategoriaDto, UpdateCategoriaDto } from './dto/categoria.dto';
import { AppGateway } from '../websocket/app.gateway';
import { SocketEvent } from '../websocket/types/socket.types';

@Injectable()
export class CategoriasService {
  private readonly CACHE_KEY = 'categorias_all';
  private readonly CACHE_TTL = 60 * 60 * 1000;

  constructor(
    private prisma: PrismaService,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
    private appGateway: AppGateway,
  ) {}

  async create(createCategoriaDto: CreateCategoriaDto) {
    const categoria = await this.prisma.categorias.create({
      data: createCategoriaDto,
    });
    await this.invalidateCache();
    this.appGateway.emitToCategorias(SocketEvent.REFRESH_CATEGORIAS, { action: 'create', categoria });
    return categoria;
  }

  async findAll() {
    const cached = await this.cacheManager.get<any>(this.CACHE_KEY);
    if (cached) {
      return cached;
    }

    const categorias = await this.prisma.categorias.findMany({
      orderBy: { nombre: 'asc' },
      include: {
        productos: {
          select: {
            IDproductos: true,
            nombre: true,
            precioUnitario: true,
            cantidad: true,
          },
        },
      },
    });

    await this.cacheManager.set(this.CACHE_KEY, categorias, this.CACHE_TTL);
    return categorias;
  }

  async findOne(id: string) {
    const categoria = await this.prisma.categorias.findUnique({
      where: { IDcategoria: id },
      include: {
        productos: true,
      },
    });

    if (!categoria) {
      throw new NotFoundException(`Categoria con ID ${id} no encontrada`);
    }

    return categoria;
  }

  async update(id: string, updateCategoriaDto: UpdateCategoriaDto) {
    const categoria = await this.prisma.categorias.findUnique({
      where: { IDcategoria: id },
    });

    if (!categoria) {
      throw new NotFoundException(`Categoria con ID ${id} no encontrada`);
    }

    const updated = await this.prisma.categorias.update({
      where: { IDcategoria: id },
      data: updateCategoriaDto,
    });

    await this.invalidateCache();
    this.appGateway.emitToCategorias(SocketEvent.REFRESH_CATEGORIAS, { action: 'update', categoria: updated });
    return updated;
  }

  async remove(id: string) {
    const categoria = await this.prisma.categorias.findUnique({
      where: { IDcategoria: id },
    });

    if (!categoria) {
      throw new NotFoundException(`Categoria con ID ${id} no encontrada`);
    }

    await this.invalidateCache();
    const deleted = await this.prisma.categorias.delete({
      where: { IDcategoria: id },
    });
    this.appGateway.emitToCategorias(SocketEvent.REFRESH_CATEGORIAS, { action: 'delete', categoriaId: id });
    return deleted;
  }

  private async invalidateCache() {
    await this.cacheManager.del(this.CACHE_KEY);
  }
}
