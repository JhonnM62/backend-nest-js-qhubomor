import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateInsumoDto, UpdateInsumoDto, InsumoQueryDto, ESTADO_STOCK } from './dto/insumo.dto';
import { Prisma } from '@prisma/client';
import { AppGateway } from '../websocket/app.gateway';
import { SocketEvent } from '../websocket/types/socket.types';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class InsumosService {
  constructor(
    private prisma: PrismaService,
    private appGateway: AppGateway,
    private notificationsService: NotificationsService
  ) {}

  async create(createInsumoDto: CreateInsumoDto) {
    const data: Prisma.InsumosUncheckedCreateInput = {
      nombre: createInsumoDto.nombre,
      categoria: createInsumoDto.categoria,
      nombreCategoria: createInsumoDto.nombreCategoria,
      unidades: createInsumoDto.unidades,
      cantidad: createInsumoDto.cantidad || 0,
      imagen: createInsumoDto.imagen,
      imageUrl: createInsumoDto.imageUrl,
      fechaDeVencimiento: createInsumoDto.fecha_de_vencimiento ? new Date(createInsumoDto.fecha_de_vencimiento) : undefined,
      precio: createInsumoDto.precio,
      total: createInsumoDto.total,
      agregarCantidad: createInsumoDto.agregar_cantidad,
      descontarCantDeVentas: createInsumoDto.descontar_cant_de_ventas,
      notificarAWhatsapp: createInsumoDto.notificar_a_whatsapp,
      apartirDeCantidad: createInsumoDto.apartir_de_cantidad,
      enviarSiONo: createInsumoDto.enviar_si_o_no || 'Si',
      disponible: createInsumoDto.cantidad || 0,
      estado: createInsumoDto.estado || 'ACTIVO',
      llevarControlEnCaja: createInsumoDto.llevar_control_en_caja,
      contador: createInsumoDto.contador,
      contador2: createInsumoDto.contador2,
      imagencard: createInsumoDto.imagencard,
      fecha: createInsumoDto.fecha ? new Date(createInsumoDto.fecha) : new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const insumo = await this.prisma.insumos.create({ data });

    await this.registrarMovimiento(
      insumo.IDalimentos,
      'entrada',
      insumo.cantidad || 0,
      'Creación de insumo'
    );

    this.appGateway.emitToInsumos(SocketEvent.REFRESH_INSUMOS, { action: 'create', data: insumo });

    this.notificationsService.sendNotification(
      'INSUMO_CREATED',
      'Nuevo Insumo Creado',
      `Se ha registrado un nuevo insumo: ${insumo.nombre}`,
      { insumoId: insumo.IDalimentos }
    );

    return {
      success: true,
      message: 'Insumo creado exitosamente',
      data: insumo,
    };
  }

  async findAll(query: InsumoQueryDto) {
    const page = query.page || 1;
    const limit = query.limit || 50;
    const skip = (page - 1) * limit;

    const where: Prisma.InsumosWhereInput = {};

    if (query.buscar) {
      where.OR = [
        { nombre: { contains: query.buscar, mode: 'insensitive' } },
        { categoria: { contains: query.buscar, mode: 'insensitive' } },
        { nombreCategoria: { contains: query.buscar, mode: 'insensitive' } },
      ];
    }

    if (query.categoria) {
      where.nombreCategoria = query.categoria;
    }

    if (query.disponible) {
      where.disponible = query.disponible;
    }

    let orderBy: Prisma.InsumosOrderByWithRelationInput = { nombre: 'asc' };

    if (query.ordenarPor) {
      const sortField = query.ordenarPor as keyof Prisma.InsumosOrderByWithRelationInput;
      orderBy = { [sortField]: query.orden || 'asc' };
    }

    const [data, total] = await Promise.all([
      this.prisma.insumos.findMany({
        where,
        skip,
        take: limit,
        orderBy,
        include: {
          categoriaInsumosRelacion: {
            select: {
              IDcategoriainsumos: true,
              nombre: true,
            },
          },
        },
      }),
      this.prisma.insumos.count({ where }),
    ]);

    const insumosConEstado = data.map(insumo => ({
      ...insumo,
      categoriaNombre: insumo.categoriaInsumosRelacion?.nombre || insumo.nombreCategoria || '',
      estadoStock: this.calcularEstadoStock(insumo),
    }));

    return {
      data: insumosConEstado,
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
    const insumo = await this.prisma.insumos.findUnique({
      where: { IDalimentos: id },
      include: {
        categoriaInsumosRelacion: {
          select: {
            IDcategoriainsumos: true,
            nombre: true,
          },
        },
      },
    });

    if (!insumo) {
      throw new NotFoundException(`Insumo con ID ${id} no encontrado`);
    }

    return {
      ...insumo,
      categoriaNombre: insumo.categoriaInsumosRelacion?.nombre || insumo.nombreCategoria || '',
      estadoStock: this.calcularEstadoStock(insumo),
    };
  }

  async update(id: string, updateInsumoDto: UpdateInsumoDto) {
    const insumo = await this.prisma.insumos.findUnique({
      where: { IDalimentos: id },
    });

    if (!insumo) {
      throw new NotFoundException(`Insumo con ID ${id} no encontrado`);
    }

    const cantidadAnterior = insumo.cantidad || 0;
    const cantidadNueva = updateInsumoDto.cantidad ?? cantidadAnterior;

    const data: Prisma.InsumosUncheckedUpdateInput = {};

    if (updateInsumoDto.nombre !== undefined) data.nombre = updateInsumoDto.nombre;
    if (updateInsumoDto.categoria !== undefined) data.categoria = updateInsumoDto.categoria;
    if (updateInsumoDto.nombreCategoria !== undefined) data.nombreCategoria = updateInsumoDto.nombreCategoria;
    if (updateInsumoDto.unidades !== undefined) data.unidades = updateInsumoDto.unidades;
    if (updateInsumoDto.cantidad !== undefined) data.cantidad = updateInsumoDto.cantidad;
    if (updateInsumoDto.imagen !== undefined) data.imagen = updateInsumoDto.imagen;
    if (updateInsumoDto.imagen === null || updateInsumoDto.imagen === '') data.imagen = null;
    
    if (updateInsumoDto.imageUrl !== undefined) data.imageUrl = updateInsumoDto.imageUrl;
    if (updateInsumoDto.imageUrl === null || updateInsumoDto.imageUrl === '') data.imageUrl = null;
    
    if (updateInsumoDto.imagencard !== undefined) data.imagencard = updateInsumoDto.imagencard;
    if (updateInsumoDto.imagencard === null || updateInsumoDto.imagencard === '') data.imagencard = null;

    if (updateInsumoDto.fecha_de_vencimiento !== undefined) data.fechaDeVencimiento = new Date(updateInsumoDto.fecha_de_vencimiento);
    if (updateInsumoDto.precio !== undefined) data.precio = updateInsumoDto.precio;
    if (updateInsumoDto.total !== undefined) data.total = updateInsumoDto.total;
    if (updateInsumoDto.agregar_cantidad !== undefined) data.agregarCantidad = updateInsumoDto.agregar_cantidad;
    if (updateInsumoDto.descontar_cant_de_ventas !== undefined) data.descontarCantDeVentas = updateInsumoDto.descontar_cant_de_ventas;
    if (updateInsumoDto.notificar_a_whatsapp !== undefined) data.notificarAWhatsapp = updateInsumoDto.notificar_a_whatsapp;
    if (updateInsumoDto.apartir_de_cantidad !== undefined) data.apartirDeCantidad = updateInsumoDto.apartir_de_cantidad;
    if (updateInsumoDto.enviar_si_o_no !== undefined) data.enviarSiONo = updateInsumoDto.enviar_si_o_no;
    if (updateInsumoDto.estado !== undefined) data.estado = updateInsumoDto.estado;
    if (updateInsumoDto.disponible !== undefined) data.disponible = String(updateInsumoDto.disponible);
    if (updateInsumoDto.precioActual !== undefined) data.precio = updateInsumoDto.precioActual;
    if (updateInsumoDto.llevar_control_en_caja !== undefined) data.llevarControlEnCaja = updateInsumoDto.llevar_control_en_caja;
    if (updateInsumoDto.contador !== undefined) data.contador = updateInsumoDto.contador;
    if (updateInsumoDto.contador2 !== undefined) data.contador2 = updateInsumoDto.contador2;
    if (updateInsumoDto.fecha !== undefined) data.fecha = new Date(updateInsumoDto.fecha);
    
    data.updatedAt = new Date();

    const insumoActualizado = await this.prisma.insumos.update({
      where: { IDalimentos: id },
      data,
    });

    if (cantidadNueva !== cantidadAnterior) {
      const diferencia = cantidadNueva - cantidadAnterior;
      const tipo = diferencia > 0 ? 'entrada' : 'salida';
      await this.registrarMovimiento(
        id,
        tipo,
        Math.abs(diferencia),
        `Ajuste manual de stock: ${cantidadAnterior} → ${cantidadNueva}`
      );
    }

    this.appGateway.emitToInsumos(SocketEvent.REFRESH_INSUMOS, { action: 'update', data: insumoActualizado });
    this.verificarAlertasStock(insumoActualizado);

    return {
      success: true,
      message: 'Insumo actualizado exitosamente',
      data: insumoActualizado,
    };
  }

  async remove(id: string) {
    const insumo = await this.prisma.insumos.findUnique({
      where: { IDalimentos: id },
    });

    if (!insumo) {
      throw new NotFoundException(`Insumo con ID ${id} no encontrado`);
    }

    await this.prisma.insumos.delete({
      where: { IDalimentos: id },
    });

    this.appGateway.emitToInsumos(SocketEvent.REFRESH_INSUMOS, { action: 'delete', id });

    this.notificationsService.sendNotification(
      'INSUMO_DELETED',
      'Insumo Eliminado',
      `Se ha eliminado el insumo: ${insumo.nombre}`,
      { insumoId: id }
    );

    return {
      success: true,
      message: 'Insumo eliminado exitosamente',
    };
  }

  async movimientoStock(
    id: string,
    tipo: 'entrada' | 'salida' | 'ajuste',
    cantidad: number,
    motivo: string,
    usuarioId?: string,
    allowNegative: boolean = false
  ) {
    if (cantidad <= 0) {
      throw new BadRequestException('La cantidad debe ser mayor a 0');
    }

    const insumo = await this.prisma.insumos.findUnique({
      where: { IDalimentos: id },
    });

    if (!insumo) {
      throw new NotFoundException(`Insumo con ID ${id} no encontrado`);
    }

    const cantidadActual = Number(insumo.disponible) || 0;
    let nuevaCantidad = cantidadActual;
    let nuevaCantidadHist = insumo.cantidad || 0;

    if (tipo === 'entrada') {
      nuevaCantidad += cantidad;
      nuevaCantidadHist += cantidad;
    } else if (tipo === 'salida') {
      if (!allowNegative && nuevaCantidad < cantidad) {
        throw new BadRequestException(
          `Stock insuficiente. Disponible: ${nuevaCantidad}, Solicitado: ${cantidad}`
        );
      }
      nuevaCantidad -= cantidad;
    } else if (tipo === 'ajuste') {
      nuevaCantidad = cantidad;
    }

    const insumoActualizado = await this.prisma.insumos.update({
      where: { IDalimentos: id },
      data: { 
        disponible: nuevaCantidad,
        cantidad: nuevaCantidadHist
      },
    });

    await this.registrarMovimiento(id, tipo, cantidad, motivo);

    this.appGateway.emitToInsumos(SocketEvent.REFRESH_INSUMOS, { action: 'movimientoStock', data: insumoActualizado });
    this.verificarAlertasStock(insumoActualizado);

    return {
      success: true,
      message: `Movimiento de stock registrado. Nueva cantidad: ${nuevaCantidad}`,
      data: {
        ...insumoActualizado,
        estadoStock: this.calcularEstadoStock(insumoActualizado),
      },
    };
  }

  async getMovimientos(id: string, limit = 50) {
    const movimientos = await this.prisma.orderinventario.findMany({
      orderBy: { fechaYHora: 'desc' },
      take: limit,
    });

    return movimientos;
  }

  async getAlertas() {
    const insumos = await this.prisma.insumos.findMany({
      where: {
        estado: 'ACTIVO',
      },
    });

    const alertas = [];

    for (const insumo of insumos) {
      const estado = this.calcularEstadoStock(insumo);
      if (estado === ESTADO_STOCK.CRITICO) {
        const cantidadDisponible = Number(insumo.disponible) || 0;
        alertas.push({
          tipo: 'critico',
          insumo: insumo.nombre,
          id: insumo.IDalimentos,
          cantidadActual: cantidadDisponible,
          mensaje: `Stock crítico: ${cantidadDisponible} unidades`,
        });
      }
    }

    return alertas;
  }

  async bulkCreate(insumos: CreateInsumoDto[]) {
    const resultados: { exitosos: any[]; fallidos: { nombre: string; error: string }[] } = {
      exitosos: [],
      fallidos: [],
    };

    for (const insumoDto of insumos) {
      try {
        const existe = await this.prisma.insumos.findFirst({
          where: { nombre: insumoDto.nombre },
        });

        if (existe) {
          resultados.fallidos.push({
            nombre: insumoDto.nombre,
            error: 'Ya existe un insumo con este nombre',
          });
          continue;
        }

        const nuevo = await this.prisma.insumos.create({
          data: {
            nombre: insumoDto.nombre,
            categoria: insumoDto.categoria,
            nombreCategoria: insumoDto.nombreCategoria,
            unidades: insumoDto.unidades,
            cantidad: insumoDto.cantidad || 0,
            imagen: insumoDto.imagen,
            imageUrl: insumoDto.imageUrl,
            precio: insumoDto.precio,
            disponible: Number(insumoDto.disponible) || 0,
            estado: insumoDto.estado || 'ACTIVO',
            llevarControlEnCaja: insumoDto.llevar_control_en_caja,
            contador: insumoDto.contador,
            contador2: insumoDto.contador2,
            imagencard: insumoDto.imagencard,
            fecha: insumoDto.fecha ? new Date(insumoDto.fecha) : new Date(),
            createdAt: new Date(),
            updatedAt: new Date(),
          } as Prisma.InsumosUncheckedCreateInput,
        });

        resultados.exitosos.push(nuevo);
      } catch (error: any) {
        resultados.fallidos.push({
          nombre: insumoDto.nombre,
          error: error.message,
        });
      }
    }

    return {
      success: true,
      message: `Creados: ${resultados.exitosos.length}, Fallidos: ${resultados.fallidos.length}`,
      data: resultados,
    };
  }

  async getEstadisticas() {
    const insumos = await this.prisma.insumos.findMany();

    const totalInsumos = insumos.length;
    const totalValor = insumos.reduce((sum, i) => sum + Number(i.total) || 0, 0);
    const totalUnidades = insumos.reduce((sum, i) => sum + (Number(i.disponible) || 0), 0);

    const criticos = insumos.filter(i => this.calcularEstadoStock(i) === ESTADO_STOCK.CRITICO).length;
    const normales = insumos.filter(i => this.calcularEstadoStock(i) === ESTADO_STOCK.NORMAL).length;
    const sobrantes = insumos.filter(i => this.calcularEstadoStock(i) === ESTADO_STOCK.SOBRANTE).length;

    return {
      totalInsumos,
      totalValor,
      totalUnidades,
      porEstado: {
        criticos,
        normales,
        sobrantes,
      },
    };
  }

  private calcularEstadoStock(insumo: any): 'critico' | 'normal' | 'sobrante' {
    const cantidad = Number(insumo.disponible) || 0;
    const stockMinimo = insumo.apartirDeCantidad || 10;
    const stockMaximo = insumo.agregarCantidad || 100;

    if (cantidad <= stockMinimo) {
      return ESTADO_STOCK.CRITICO;
    } else if (cantidad >= stockMaximo) {
      return ESTADO_STOCK.SOBRANTE;
    }
    return ESTADO_STOCK.NORMAL;
  }

  private verificarAlertasStock(insumo: any) {
    const cantidad = Number(insumo.disponible) || 0;
    const stockMinimo = insumo.apartirDeCantidad || 10;
    
    if (cantidad < 0) {
      this.notificationsService.sendNotification(
        'INSUMO_STOCK_NEGATIVE',
        'Stock Negativo de Insumo',
        `El insumo "${insumo.nombre}" tiene un stock negativo de ${cantidad}.`,
        { insumoId: insumo.IDalimentos }
      );
    } else if (cantidad <= stockMinimo) {
      this.notificationsService.sendNotification(
        'INSUMO_STOCK_LOW',
        'Stock Bajo de Insumo',
        `El insumo "${insumo.nombre}" tiene un stock crítico de ${cantidad} (Mínimo: ${stockMinimo}).`,
        { insumoId: insumo.IDalimentos }
      );
    } else {
      // Si quieres notificar cuando vuelve a estar positivo, pero usualmente no es tan necesario, 
      // o podrías mapearlo a INSUMO_STOCK_POSITIVE.
    }
  }

  private async registrarMovimiento(
    insumoId: string,
    tipo: 'entrada' | 'salida' | 'ajuste',
    cantidad: number,
    observacion: string
  ) {
    const insumo = await this.prisma.insumos.findUnique({
      where: { IDalimentos: insumoId },
    });

    await this.prisma.orderinventario.create({
      data: {
        categoria: insumo?.categoria || '',
        nombreDelAlimento: insumo?.nombre || '',
        cantidad: cantidad,
        observacion: observacion,
        nombreCategoria: insumo?.nombreCategoria || '',
        fecha: new Date(),
        disponible: tipo === 'entrada' ? 'Si' : 'No',
        fechaYHora: new Date(),
        seCompro: tipo === 'entrada' ? 'Si' : 'No',
      },
    });
  }

  async descontarStock(insumoId: string, cantidad: number, observacion: string) {
    const insumo = await this.prisma.insumos.findUnique({
      where: { IDalimentos: insumoId },
    });

    if (!insumo) {
      throw new NotFoundException(`Insumo con ID ${insumoId} no encontrado`);
    }

    const cantidadDisponible = Number(insumo.disponible) || 0;
    if (cantidadDisponible < cantidad) {
      throw new BadRequestException(
        `Stock insuficiente. Disponible: ${cantidadDisponible}, Solicitado: ${cantidad}`
      );
    }

    const nuevaCantidad = cantidadDisponible - cantidad;

    const insumoActualizado = await this.prisma.insumos.update({
      where: { IDalimentos: insumoId },
      data: { disponible: nuevaCantidad },
    });

    await this.registrarMovimiento(insumoId, 'salida', cantidad, observacion);

    this.appGateway.emitToInsumos(SocketEvent.REFRESH_INSUMOS, { action: 'descontarStock', id: insumoId, cantidadActual: nuevaCantidad });
    this.verificarAlertasStock(insumoActualizado);

    return {
      success: true,
      message: `Stock descontado. Nueva cantidad: ${nuevaCantidad}`,
      cantidadActual: nuevaCantidad,
    };
  }

  async agregarStock(insumoId: string, cantidad: number, observacion: string) {
    const insumo = await this.prisma.insumos.findUnique({
      where: { IDalimentos: insumoId },
    });

    if (!insumo) {
      throw new NotFoundException(`Insumo con ID ${insumoId} no encontrado`);
    }

    const cantidadDisponible = Number(insumo.disponible) || 0;
    const nuevaCantidad = cantidadDisponible + cantidad;
    const nuevaCantidadHist = (insumo.cantidad || 0) + cantidad;

    const insumoActualizado = await this.prisma.insumos.update({
      where: { IDalimentos: insumoId },
      data: { 
        disponible: nuevaCantidad,
        cantidad: nuevaCantidadHist
      },
    });

    await this.registrarMovimiento(insumoId, 'entrada', cantidad, observacion);

    this.appGateway.emitToInsumos(SocketEvent.REFRESH_INSUMOS, { action: 'agregarStock', id: insumoId, cantidadActual: nuevaCantidad });
    this.verificarAlertasStock(insumoActualizado);

    return {
      success: true,
      message: `Stock agregado. Nueva cantidad: ${nuevaCantidad}`,
      cantidadActual: nuevaCantidad,
    };
  }
}