import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateProductoDto, UpdateProductoDto, ProductoQueryDto } from './dto/producto.dto';
import { Prisma } from '@prisma/client';
import { NotificationsService } from '../notifications/notifications.service';
import { AppGateway } from '../websocket/app.gateway';
import { SocketEvent } from '../websocket/types/socket.types';

@Injectable()
export class ProductosService {
  constructor(
    private prisma: PrismaService,
    private notificationsService: NotificationsService,
    private appGateway: AppGateway,
  ) {}

  async create(createProductoDto: CreateProductoDto) {
    const { recetaInsumos, ...productoData } = createProductoDto;

    const producto = await this.prisma.productos.create({
      data: {
        ...(productoData as Prisma.ProductosCreateInput),
        ...(recetaInsumos && recetaInsumos.length > 0
          ? {
              recetaInsumos: {
                create: recetaInsumos.map((receta) => ({
                  insumo: receta.insumo,
                  tipoDeMedida: receta.tipoDeMedida,
                  cantidad: receta.cantidad,
                })),
              },
            }
          : {}),
      },
      include: {
        recetaInsumos: true,
      },
    });

    this.appGateway.emitToProductos(SocketEvent.REFRESH_PRODUCTOS, { action: 'create', producto });

    return producto;
  }

  async findAll(query: ProductoQueryDto) {
    const { page = 1, limit = 500, categoria, buscar, soloMostrar = false } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.ProductosWhereInput = {};

    if (categoria) {
      where.categoria = categoria;
    }

    if (buscar) {
      where.OR = [
        { nombre: { contains: buscar, mode: 'insensitive' } },
        { categoriaNombre: { contains: buscar, mode: 'insensitive' } },
      ];
    }

    if (soloMostrar) {
      where.mostrar = 'si';
    }

    try {
      const [data, total] = await Promise.all([
        this.prisma.productos.findMany({
          where,
          skip,
          take: limit,
          orderBy: { orden: 'asc' },
          include: {
            categoriaRelacion: {
              select: { IDcategoria: true, nombre: true, image: true },
            },
          },
        }),
        this.prisma.productos.count({ where }),
      ]);

      const dataPlain = data.map((p) => ({
        ...p,
        categoriaNombre: p.categoriaRelacion?.nombre || p.categoriaNombre,
      }));

      return {
        data: dataPlain,
        meta: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
          hasNextPage: page < Math.ceil(total / limit),
          hasPreviousPage: page > 1,
        },
      };
    } catch (error) {
      console.error('Error fetching products from DB:', error);
      // Fallback response if DB fails (e.g. connection timeout)
      return {
        data: [],
        meta: {
          total: 0,
          page,
          limit,
          totalPages: 0,
          hasNextPage: false,
          hasPreviousPage: false,
        },
      };
    }
  }

  async findOne(id: string) {
    const producto = await this.prisma.productos.findUnique({
      where: { IDproductos: id },
      include: {
        categoriaRelacion: true,
        recetaInsumos: {
          include: { insumoRelacion: true },
        },
      },
    });

    if (!producto) {
      throw new NotFoundException(`Producto con ID ${id} no encontrado`);
    }

    return producto;
  }

  async update(id: string, updateProductoDto: UpdateProductoDto) {
    const { recetaInsumos, ...productoData } = updateProductoDto;

    const producto = await this.prisma.productos.findUnique({
      where: { IDproductos: id },
    });

    if (!producto) {
      throw new NotFoundException(`Producto con ID ${id} no encontrado`);
    }

    // Si se envían recetaInsumos, borramos los existentes y los volvemos a crear (reemplazo completo)
    if (recetaInsumos) {
      await this.prisma.recetainsumos.deleteMany({
        where: { IDproductos: id },
      });
    }

    const updatedProducto = await this.prisma.productos.update({
      where: { IDproductos: id },
      data: {
        ...(productoData as Prisma.ProductosUpdateInput),
        ...(recetaInsumos
          ? {
              recetaInsumos: {
                create: recetaInsumos.map((receta) => ({
                  insumo: receta.insumo,
                  tipoDeMedida: receta.tipoDeMedida,
                  cantidad: receta.cantidad,
                })),
              },
            }
          : {}),
      },
      include: {
        recetaInsumos: {
          include: {
            insumoRelacion: true,
          },
        },
      },
    });

    if (productoData.precioUnitario !== undefined && Number(productoData.precioUnitario) !== Number(producto.precioUnitario)) {
      this.notificationsService.sendNotification(
        'PRODUCTO_PRICE_CHANGED',
        'Cambio de Precio',
        `El precio de '${producto.nombre}' ha cambiado de $${producto.precioUnitario || 0} a $${productoData.precioUnitario}.`,
        { productoId: id }
      );
    }

    if (recetaInsumos) {
      this.notificationsService.sendNotification(
        'PRODUCTO_RECIPE_CHANGED',
        'Receta Modificada',
        `Se ha modificado la receta de insumos para '${producto.nombre}'.`,
        { productoId: id }
      );
    }

    this.appGateway.emitToProductos(SocketEvent.REFRESH_PRODUCTOS, { action: 'update', producto: updatedProducto });

    return updatedProducto;
  }

  async remove(id: string) {
    const producto = await this.prisma.productos.findUnique({
      where: { IDproductos: id },
      include: {
        ordenVentas: {
          take: 1,
        },
      },
    });

    if (!producto) {
      throw new NotFoundException(`Producto con ID ${id} no encontrado`);
    }

    if (producto.ordenVentas && producto.ordenVentas.length > 0) {
      throw new BadRequestException('No se puede eliminar un producto que tiene ventas asociadas. Considere cambiar su estado a "no mostrar" en su lugar.');
    }

    // Delete recipes first because of foreign key constraint
    await this.prisma.recetainsumos.deleteMany({
      where: { IDproductos: id },
    });

    const deletedProducto = await this.prisma.productos.delete({
      where: { IDproductos: id },
    });

    this.appGateway.emitToProductos(SocketEvent.REFRESH_PRODUCTOS, { action: 'delete', productoId: id });

    return deletedProducto;
  }

  async updateStock(id: string, cantidad: number) {
    return this.prisma.productos.update({
      where: { IDproductos: id },
      data: {
        cantidad: { decrement: cantidad },
        fechaDeCantidadAgregada: new Date(),
      },
    });
  }
}
