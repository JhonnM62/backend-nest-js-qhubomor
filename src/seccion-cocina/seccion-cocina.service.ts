import { Injectable, NotFoundException, Inject } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { PrismaService } from '../prisma/prisma.service';
import { AppGateway } from '../websocket/app.gateway';
import { SocketEvent } from '../websocket/types/socket.types';
import { CreateSeccionCocinaDto, UpdateSeccionCocinaDto } from './dto/seccion-cocina.dto';

@Injectable()
export class SeccionCocinaService {
  private readonly CACHE_KEY = 'secciones_cocina_all';
  private readonly CACHE_TTL = 60 * 60 * 1000; // 1 hora

  constructor(
    private prisma: PrismaService,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
    private appGateway: AppGateway,
  ) {}

  async create(dto: CreateSeccionCocinaDto) {
    const seccion = await this.prisma.seccionCocina.create({ data: dto });
    await this.invalidateCache();
    this.appGateway.emitToAll(SocketEvent.REFRESH_SECCIONES_COCINA, { action: 'create', seccion });
    return seccion;
  }

  async findAll() {
    const cached = await this.cacheManager.get<any>(this.CACHE_KEY);
    if (cached) return cached;

    const secciones = await this.prisma.seccionCocina.findMany({
      where: { activa: true },
      orderBy: { orden: 'asc' },
    });

    await this.cacheManager.set(this.CACHE_KEY, secciones, this.CACHE_TTL);
    return secciones;
  }

  async findAllIncludingInactive() {
    return this.prisma.seccionCocina.findMany({ orderBy: { orden: 'asc' } });
  }

  async findOne(id: string) {
    const seccion = await this.prisma.seccionCocina.findUnique({
      where: { IDseccion: id },
      include: {
        productos: {
          select: { IDproductos: true, nombre: true, categoriaNombre: true },
        },
      },
    });
    if (!seccion) throw new NotFoundException(`Sección con ID ${id} no encontrada`);
    return seccion;
  }

  async update(id: string, dto: UpdateSeccionCocinaDto) {
    await this.findOne(id); // valida existencia
    const updated = await this.prisma.seccionCocina.update({
      where: { IDseccion: id },
      data: dto,
    });
    await this.invalidateCache();
    this.appGateway.emitToAll(SocketEvent.REFRESH_SECCIONES_COCINA, { action: 'update', seccion: updated });
    return updated;
  }

  async remove(id: string) {
    await this.findOne(id); // valida existencia
    // Desasociar productos antes de eliminar
    await this.prisma.productos.updateMany({
      where: { seccionCocinaId: id },
      data: { seccionCocinaId: null },
    });
    const deleted = await this.prisma.seccionCocina.delete({ where: { IDseccion: id } });
    await this.invalidateCache();
    this.appGateway.emitToAll(SocketEvent.REFRESH_SECCIONES_COCINA, { action: 'delete', seccionId: id });
    return deleted;
  }

  private async invalidateCache() {
    await this.cacheManager.del(this.CACHE_KEY);
  }
}
