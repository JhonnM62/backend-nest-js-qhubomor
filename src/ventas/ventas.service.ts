import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateVentaDto, CreateOrderVentaDto, CreateVentaCompletaDto, VentaQueryDto } from './dto/venta.dto';
import { Prisma } from '@prisma/client';
import { NotificationsService } from '../notifications/notifications.service';
import { InsumosService } from '../insumos/insumos.service';
import { AppGateway } from '../websocket/app.gateway';
import { SocketEvent } from '../websocket/types/socket.types';

@Injectable()
export class VentasService {
  constructor(
    private prisma: PrismaService,
    private notificationsService: NotificationsService,
    private insumosService: InsumosService,
    private appGateway: AppGateway,
  ) {}

  private formatDuration(diffMs: number): string {
    const totalSeconds = Math.max(0, Math.floor(diffMs / 1000));
    const d = Math.floor(totalSeconds / 86400);
    const h = Math.floor((totalSeconds % 86400) / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    return `${d.toString().padStart(2, '0')}:${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }

  private generateTiempoLog(estadoFinal: string = 'iniciado', cartStartTime?: string | null) {
    const now = new Date();
    
    // Si tenemos un cartStartTime, significa que el usuario inició el carrito antes de enviarlo
    if (cartStartTime && estadoFinal && estadoFinal !== 'iniciado' && estadoFinal !== 'EN_EL_CARRITO') {
      const inicioTime = new Date(cartStartTime);
      const diffMs = now.getTime() - inicioTime.getTime();
      const duracionFinal = diffMs > 0 ? this.formatDuration(diffMs) : '00:00:00:00';

      return [
        {
          fecha_hora: inicioTime.toISOString(),
          estado: 'iniciado',
          duracion: '00:00:00:00',
        },
        {
          fecha_hora: now.toISOString(),
          estado: estadoFinal,
          duracion: duracionFinal,
        }
      ];
    }

    return [
      {
        fecha_hora: now.toISOString(),
        estado: estadoFinal || 'iniciado',
        duracion: '00:00:00:00',
      }
    ];
  }

  private appendTiempoLog(existingLog: any, nuevoEstado: string) {
    let log = Array.isArray(existingLog) ? existingLog : [];
    
    // Prevent consecutive duplicate states
    if (log.length > 0 && log[log.length - 1].estado === nuevoEstado) {
      return log;
    }

    const now = new Date();
    let duracion = '00:00:00:00';

    if (log.length > 0) {
      const lastEntryTime = new Date(log[log.length - 1].fecha_hora);
      const diffMs = now.getTime() - lastEntryTime.getTime();
      duracion = this.formatDuration(diffMs);
    }

    return [
      ...log,
      {
        fecha_hora: now.toISOString(),
        estado: nuevoEstado,
        duracion,
      },
    ];
  }

  private async applyRecipeDeductions(
    productos: CreateOrderVentaDto[] | Prisma.OrderventasGetPayload<{}>[], 
    tipo: 'entrada' | 'salida', 
    motivoPrefijo: string
  ) {
    if (!productos || productos.length === 0) return;

    for (const producto of productos) {
      const productoId = producto.productoId || (producto as any).IDproductos;
      const cantidadVendida = producto.cantidad || 0;
      const nombreProd = producto.nombre || producto.nombreProducto || 'Producto';

      if (!productoId || cantidadVendida <= 0) continue;

      // Buscar la receta de este producto
      const recetas = await this.prisma.recetainsumos.findMany({
        where: { IDproductos: productoId },
        include: { insumoRelacion: true },
      });

      for (const receta of recetas) {
        const insumo = receta.insumoRelacion;
        const descontarFlag = insumo?.descontarCantDeVentas?.toLowerCase() === 'si';
        
        if (insumo && descontarFlag && receta.cantidad) {
          const cantidadTotal = cantidadVendida * receta.cantidad;
          if (cantidadTotal > 0) {
            try {
              await this.insumosService.movimientoStock(
                insumo.IDalimentos,
                tipo,
                cantidadTotal,
                `${motivoPrefijo}: ${nombreProd}`,
                undefined,
                true // allowNegative
              );
            } catch (error) {
              console.error(`Error aplicando descuento de receta para insumo ${insumo.nombre}:`, error);
            }
          }
        }
      }
    }
  }

  private async getFechaContable(date: Date = new Date(), manualDate?: string): Promise<Date> {
    if (manualDate) {
      // Si el frontend envía una fecha manual ("Ventas Olvidadas"), la respetamos
      const parts = manualDate.split('-');
      if (parts.length === 3) {
        return new Date(Date.UTC(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2])));
      }
    }

    // Buscar configuración dinámica
    let config = await this.prisma.configuracionNegocio.findUnique({ where: { id: 1 } });
    if (!config) {
      config = {
        id: 1,
        nombreComercial: 'Q HUBO MOR',
        nit: null,
        direccion: null,
        telefono: null,
        horaCorteDia: '00:00',
        modoOperacion: 'GENERAL',
        latitudNegocio: null,
        longitudNegocio: null,
        radioGeocercaM: 100,
        minutosGraciaLlegadaTarde: 5,
        updatedAt: new Date(),
      };
    }
    
    const [corteHours, corteMinutes] = config!.horaCorteDia.split(':').map(Number);

    // FIX: Los servidores Docker están en UTC. 
    // Forzamos el cálculo basado en la zona horaria local (UTC-5 Colombia)
    const localDate = new Date(date.getTime() - (5 * 60 * 60 * 1000));

    // Si la hora local es antes de la hora de corte, pertenece al día contable anterior
    const currentMinutes = (localDate.getUTCHours() * 60) + localDate.getUTCMinutes();
    const corteTotalMinutes = (corteHours * 60) + corteMinutes;

    if (currentMinutes < corteTotalMinutes) {
      localDate.setUTCDate(localDate.getUTCDate() - 1);
    }

    // Normalizamos a medianoche para que funcione como una "fecha pura" sin horas
    localDate.setUTCHours(0, 0, 0, 0);
    // Para guardarlo en la BD de Prisma sin desfases, devolvemos la fecha UTC normalizada
    return localDate;
  }

  async create(createVentaDto: CreateVentaDto & { fechaContableManual?: string }) {
    console.log('[DEBUG create] createVentaDto.mesa:', createVentaDto.mesa);
    console.log('[DEBUG create] createVentaDto.clienteId:', createVentaDto.clienteId);
    console.log('[DEBUG create] Full DTO:', JSON.stringify(createVentaDto));
    
    const now = new Date();
    const fechaContable = await this.getFechaContable(now, createVentaDto.fechaContableManual);
    const pedido = await this.generatePedidoNumber(createVentaDto.mesa, undefined, fechaContable);

    const ventaData: any = {
      ...createVentaDto,
      fechaContableManual: undefined,
      mesa: createVentaDto.mesa === 'V.R' ? null : createVentaDto.mesa,
      pedido,
      fechaYHora: now,
      fecha: fechaContable,
      hora: now.toLocaleTimeString('en-US', { timeZone: 'America/Bogota', hour12: false }),
      estado: createVentaDto.estado || 'iniciado',
      registroDeTiempo: this.generateTiempoLog(createVentaDto.estado || 'iniciado', createVentaDto.cartStartTime),
    };

    console.log('[DEBUG create] ventaData.mesa:', ventaData.mesa);
    console.log('[DEBUG create] ventaData.clienteId:', ventaData.clienteId);

    const venta = await this.prisma.ventas.create({
      data: ventaData,
    });

    if (ventaData.clienteId) {
      await this.prisma.clientes.update({
        where: { IDcliente: ventaData.clienteId },
        data: { fecha_y_hora_actualizacion: new Date() }
      });
    }

    this.appGateway.emitToVentas(SocketEvent.REFRESH_VENTAS, { action: 'create', venta });

    return venta;
  }

  async generatePedidoNumber(mesaId: string | null | undefined, usuarioNombre: string | null | undefined, providedFechaContable?: Date): Promise<string> {
    const fechaContable = providedFechaContable || await this.getFechaContable(new Date());

    const ventasDelTurno = await this.prisma.ventas.findMany({
      where: {
        fecha: fechaContable,
      },
      select: {
        pedido: true,
      },
    });

    let maxConsecutivo = 0;
    for (const venta of ventasDelTurno) {
      if (venta.pedido) {
        const match = venta.pedido.match(/-(\d+)$/);
        if (match) {
          const num = parseInt(match[1], 10);
          if (num > maxConsecutivo) {
            maxConsecutivo = num;
          }
        }
      }
    }

    const siguienteNumero = maxConsecutivo + 1;
    const numeroConsecutivo = siguienteNumero.toString().padStart(3, '0');

    let mesaStr = 'V.R';
    if (mesaId && mesaId !== 'V.R') {
      try {
        const mesaObj = await this.prisma.mesas.findUnique({
          where: { IdMesas: mesaId },
        });
        if (mesaObj && mesaObj.nombre) {
          mesaStr = mesaObj.nombre;
        }
      } catch (error) {
        // mesa not found, keep V.R
      }
    }

    const inicial = usuarioNombre ? usuarioNombre.charAt(0).toUpperCase() : 'X';

    return `${mesaStr}-${inicial}-${numeroConsecutivo}`;
  }

  private async actualizarComprasCliente(
    prisma: any,
    clienteId: number,
    ventaId: string,
    productos: any[]
  ): Promise<number> {
    // Cantidad total de items en esta venta (para el histórico de 'compras')
    const cantidadVenta = productos.reduce((total, p) => total + (p.cantidad || 1), 0);

    const cliente = await prisma.clientes.findUnique({
      where: { IDcliente: clienteId }
    });

    if (!cliente) return 0;

    // Histórico total de items comprados (campo 'compras' en Clientes)
    let comprasTotales = parseInt(cliente.compras || '0', 10);
    if (isNaN(comprasTotales)) comprasTotales = 0;
    comprasTotales += cantidadVenta;

    // --- Lógica del contador de fidelidad con checkpoints en 5 y 10 ---
    // El contador suma items de cada venta, pero tiene dos "topes" o hitos:
    //
    // REGLAS:
    // 1. Si el contador está por debajo de 5 y la suma superaría 5 → se queda en 5.
    //    (La próxima compra continúa desde 5 hacia el siguiente hito).
    // 2. Si el contador ya está en 5 o más y la suma superaría 10 → se queda en 10.
    // 3. Si el contador ya estaba en 10 → se REINICIA a 0 y se aplican las reglas
    //    normales con la cantidad de esta compra (puede llegar a 5 máximo en esta compra).
    //
    // Ejemplos:
    //   contador=3, compra 6  → 3+6=9 > 5, estaba <5 → queda en 5
    //   contador=5, compra 3  → 5+3=8, no supera 10  → queda en 8
    //   contador=5, compra 7  → 5+7=12 > 10           → queda en 10
    //   contador=10, compra 4 → reset a 0, 0+4=4      → queda en 4
    //   contador=10, compra 8 → reset a 0, 0+8=8 > 5  → queda en 5

    let base = cliente.contador || 0;
    let nuevoContador: number;

    if (base >= 10) {
      // Ciclo completado: reiniciar y aplicar reglas con la cantidad de esta compra
      base = 0;
    }

    const suma = base + cantidadVenta;

    if (base < 5 && suma > 5) {
      // Primera barrera: no puede pasar de 5 si venía de menos de 5
      nuevoContador = 5;
    } else if (suma > 10) {
      // Segunda barrera: no puede pasar de 10
      nuevoContador = 10;
    } else {
      nuevoContador = suma;
    }

    await prisma.clientes.update({
      where: { IDcliente: clienteId },
      data: {
        contador: nuevoContador,
        compras: comprasTotales.toString(),
        fecha_y_hora_actualizacion: new Date()
      }
    });

    // Retornar el nuevo contador para guardarlo en el campo 'Compras' de VENTAS
    return nuevoContador;
  }


  async createVentaCompleta(createVentaCompletaDto: CreateVentaCompletaDto & { fechaContableManual?: string }, usuarioId: string) {
    const { venta, productos, fechaContableManual } = createVentaCompletaDto;

    const usuario = await this.prisma.usuarios.findUnique({
      where: { IDusuarios: usuarioId },
      select: { nombre: true },
    });

    const fechaVenta = new Date();
    const fechaContable = await this.getFechaContable(fechaVenta, fechaContableManual);

    const pedidoGenerado = await this.generatePedidoNumber(
      venta.mesa && venta.mesa !== 'V.R' ? venta.mesa : null,
      usuario?.nombre,
      fechaContable
    );

    // Buscar nombre del cliente si hay clienteId
    let clienteNombre: string | null = null;
    if (venta.clienteId) {
      const clienteData = await this.prisma.clientes.findUnique({
        where: { IDcliente: venta.clienteId },
        select: { nombre: true }
      });
      clienteNombre = clienteData?.nombre ?? null;
    }

    const ventaData = {
      mesa: (venta.mesa === 'V.R' || venta.mesa === 'CAJA') ? null : (venta.mesa || null),
      medioDePago: venta.medioDePago,
      efectivoRecibido: venta.efectivoRecibido,
      devueltas: venta.devueltas,
      banco: venta.medioDePago === 'EFECTIVO' ? null : venta.banco,
      totalInput: venta.totalInput,
      descuento: venta.descuento,
      porcentajeDeDescuento: venta.porcentajeDeDescuento,
    };

    const ventaCreada = await this.prisma.ventas.create({
      data: {
        ...ventaData,
        pedido: pedidoGenerado,
        estado: venta.estado || 'EN_EL_CARRITO',
        usuario: usuarioId,
        fechaYHora: fechaVenta,
        fecha: fechaContable,
        hora: fechaVenta.toLocaleTimeString('en-US', { timeZone: 'America/Bogota', hour12: false }),
        registroDeTiempo: this.generateTiempoLog(venta.estado || 'EN_EL_CARRITO', (venta as any).cartStartTime),
        clienteId: venta.clienteId || null,
        cliente: clienteNombre,  // Columna "Clente" – nombre en texto
      } as Prisma.VentasUncheckedCreateInput,
    });

    // Si hay un cliente asociado, actualizar sus compras/contador y obtener el valor resultante
    if (venta.clienteId) {
      const nuevoContador = await this.actualizarComprasCliente(this.prisma, venta.clienteId, ventaCreada.IDventas, productos);
      // Guardar el valor del contador en el campo 'Compras' de esta venta
      await this.prisma.ventas.update({
        where: { IDventas: ventaCreada.IDventas },
        data: { compras: nuevoContador.toString() } as Prisma.VentasUncheckedUpdateInput,
      });
    }

    const ordenesVentas = await Promise.all(
      productos.map(async (producto) => {
        let nombreProducto: string | undefined | null = producto.nombre;
        let categoriaProducto: string | undefined | null = producto.categoria;

        if (producto.productoId) {
          const productoData = await this.prisma.productos.findUnique({
            where: { IDproductos: producto.productoId },
          });
          if (productoData) {
            nombreProducto = productoData.nombre || undefined;
            categoriaProducto = productoData.categoriaNombre || productoData.categoria || undefined;
          }
        }

        // Apply Jornada Comercial to Orderventas
        const orderFechaContable = fechaContable;

        return this.prisma.orderventas.create({
          data: {
            ...producto,
            nombre: nombreProducto,
            categoria: categoriaProducto,
            nombreProducto,
            categoriaProducto,
            imagenUrl: producto.imagenUrl,
            IDventas: ventaCreada.IDventas,
            usuarioId,
            fecha: orderFechaContable, // Use accounting date
          } as Prisma.OrderventasCreateInput,
        });
      }),
    );

    this.notificationsService.sendNotification(
      'VENTA_CREATED',
      'Nueva Venta Creada',
      `Se ha creado el pedido ${pedidoGenerado} por $${ventaData.totalInput || 0}`,
      { ventaId: ventaCreada.IDventas }
    );

    // DEDUCCIÓN DE INVENTARIO
    await this.applyRecipeDeductions(productos, 'salida', 'Descuento por venta');

    const resultVenta = {
      ...ventaCreada,
      ordenVentas: ordenesVentas,
    };

    this.appGateway.emitToVentas(SocketEvent.REFRESH_VENTAS, { action: 'create', venta: resultVenta });

    return resultVenta;
  }

  async updateVentaCompleta(id: string, updateVentaCompletaDto: CreateVentaCompletaDto & { fechaContableManual?: string }, usuarioId: string) {
    const { venta, productos, fechaContableManual } = updateVentaCompletaDto;

    const ventaExistente = await this.prisma.ventas.findUnique({
      where: { IDventas: id },
    });

    if (!ventaExistente) {
      throw new NotFoundException(`Venta con ID ${id} no encontrada`);
    }

    const fechaContable = fechaContableManual ? 
      await this.getFechaContable(new Date(), fechaContableManual) : 
      ventaExistente.fecha; // Maintain existing if not overridden

    // Buscar nombre del cliente si hay clienteId
    let clienteNombre: string | null = null;
    if (venta.clienteId) {
      const clienteData = await this.prisma.clientes.findUnique({
        where: { IDcliente: venta.clienteId },
        select: { nombre: true }
      });
      clienteNombre = clienteData?.nombre ?? null;
    }

    const estadoToSave = venta.estado || ventaExistente.estado || 'iniciado';
    const nuevoRegistro = this.appendTiempoLog(ventaExistente.registroDeTiempo, estadoToSave);

    const nuevaMesaValue = (venta.mesa === 'V.R' || venta.mesa === 'CAJA') ? null : (venta.mesa || null);

    let pedidoToSave = ventaExistente.pedido;
    if (ventaExistente.mesa !== nuevaMesaValue && ventaExistente.pedido) {
      let mesaStr = 'V.R';
      if (nuevaMesaValue) {
        try {
          const mesaObj = await this.prisma.mesas.findUnique({
            where: { IdMesas: nuevaMesaValue },
          });
          if (mesaObj && mesaObj.nombre) {
            mesaStr = mesaObj.nombre;
          }
        } catch (e) {}
      }
      const partes = ventaExistente.pedido.split('-');
      if (partes.length >= 3) {
        partes[0] = mesaStr;
        pedidoToSave = partes.join('-');
      }
    }

    const ventaData = {
      mesa: nuevaMesaValue,
      pedido: pedidoToSave,
      medioDePago: venta.medioDePago,
      efectivoRecibido: venta.efectivoRecibido,
      devueltas: venta.devueltas,
      banco: venta.medioDePago === 'EFECTIVO' ? null : venta.banco,
      totalInput: venta.totalInput,
      descuento: venta.descuento,
      porcentajeDeDescuento: venta.porcentajeDeDescuento,
      estado: estadoToSave,
      fecha: fechaContable,
      clienteId: venta.clienteId || null,
      cliente: clienteNombre,  // Columna "Clente" – nombre en texto
      registroDeTiempo: nuevoRegistro,
    };

    // Update Venta
    let ventaActualizada = await this.prisma.ventas.update({
      where: { IDventas: id },
      data: ventaData as Prisma.VentasUncheckedUpdateInput,
    });

    // Si hay un cliente asociado, actualizar sus compras/contador y guardar el resultado en la venta
    if (venta.clienteId) {
      const nuevoContador = await this.actualizarComprasCliente(this.prisma, venta.clienteId, id, productos);
      ventaActualizada = await this.prisma.ventas.update({
        where: { IDventas: id },
        data: { compras: nuevoContador.toString() } as Prisma.VentasUncheckedUpdateInput,
      });
    }

    // Replace all Orderventas
    const oldOrderventas = await this.prisma.orderventas.findMany({
      where: { IDventas: id },
    });

    // REVERSO DE INVENTARIO
    // Devolvemos el stock de los productos viejos
    await this.applyRecipeDeductions(oldOrderventas, 'entrada', 'Reverso por edición de venta');

    await this.prisma.orderventas.deleteMany({
      where: { IDventas: id },
    });

    if (productos && productos.length > 0) {
      await Promise.all(
        productos.map(async (producto) => {
          const productoData = await this.prisma.productos.findFirst({
            where: { IDproductos: producto.productoId },
            select: { nombre: true, categoria: true, categoriaNombre: true },
          });

          let nombreProducto = producto.nombre;
          let categoriaProducto = producto.categoria;

          if (productoData) {
            if (!nombreProducto || nombreProducto.trim() === '') {
              nombreProducto = productoData.nombre;
            }
            if (!categoriaProducto || categoriaProducto.trim() === '') {
              categoriaProducto = productoData.categoriaNombre || productoData.categoria || undefined;
            }
          }

          return this.prisma.orderventas.create({
            data: {
              ...producto,
              nombre: nombreProducto,
              categoria: categoriaProducto,
              nombreProducto,
              categoriaProducto,
              imagenUrl: producto.imagenUrl,
              IDventas: ventaActualizada.IDventas,
              usuarioId,
              fecha: fechaContable,
            } as Prisma.OrderventasCreateInput,
          });
        }),
      );

      // APLICACIÓN DE NUEVO INVENTARIO
      await this.applyRecipeDeductions(productos, 'salida', 'Descuento por venta editada');
    }

    const updatedVentaWithOrders = await this.prisma.ventas.findUnique({
      where: { IDventas: id },
      include: { ordenVentas: true },
    });

    if (updatedVentaWithOrders) {
      this.appGateway.emitToVentas(SocketEvent.REFRESH_VENTAS, { action: 'updateEstado', venta: updatedVentaWithOrders });
    }

    return updatedVentaWithOrders;
  }

  async ajustarProductoEnVenta(ventaId: string, orderVentaId: string, nuevaCantidad: number, usuarioId: string) {
    const venta = await this.prisma.ventas.findUnique({
      where: { IDventas: ventaId },
      include: { ordenVentas: true },
    });

    if (!venta) {
      throw new NotFoundException(`Venta con ID ${ventaId} no encontrada`);
    }

    const orderVenta = venta.ordenVentas.find((ov) => ov.IDorderventas === orderVentaId);
    if (!orderVenta) {
      throw new NotFoundException(`Producto de venta con ID ${orderVentaId} no encontrado en la venta ${ventaId}`);
    }

    const cantidadAnterior = Number(orderVenta.cantidad) || 0;
    const diff = nuevaCantidad - cantidadAnterior;

    if (diff === 0) {
      return venta; // No changes
    }

    // Actualizar o eliminar OrderVenta
    if (nuevaCantidad <= 0) {
      await this.prisma.orderventas.delete({
        where: { IDorderventas: orderVentaId },
      });
    } else {
      const nuevoPrecioTotal = Number(orderVenta.precio || 0) * nuevaCantidad;
      await this.prisma.orderventas.update({
        where: { IDorderventas: orderVentaId },
        data: {
          cantidad: nuevaCantidad,
          precioTotal: nuevoPrecioTotal,
        },
      });
    }

    // Recalcular totalInput de la Venta
    const remainingOrders = await this.prisma.orderventas.findMany({
      where: { IDventas: ventaId },
    });
    
    let totalModifiers = 0;
    remainingOrders.forEach(order => {
      try {
        if ((order as any).modificadores) {
          const parsedModifiers = typeof (order as any).modificadores === 'string' ? JSON.parse((order as any).modificadores) : (order as any).modificadores;
          if (Array.isArray(parsedModifiers)) {
            parsedModifiers.forEach((m: any) => {
              totalModifiers += (Number(m.precio || m.Precio || m.price || 0)) * (Number(m.cantidad || 1));
            });
          }
        }
      } catch (error) {
        console.error('Error parseando modificadores', error);
      }
    });

    const nuevoTotalInput = remainingOrders.reduce((acc, order) => acc + (Number(order.precioTotal) || 0), 0);
    const totalDescuento = Number(venta.descuento || 0);

    const finalTotalInput = Math.max(0, nuevoTotalInput + totalModifiers - totalDescuento);

    const ventaActualizada = await this.prisma.ventas.update({
      where: { IDventas: ventaId },
      data: {
        totalInput: finalTotalInput,
      },
      include: { ordenVentas: true },
    });

    // Actualizar inventario
    const absDiff = Math.abs(diff);
    const tipoMovimiento = diff < 0 ? 'entrada' : 'salida';
    const motivo = diff < 0 ? 'Reverso por cuadre de caja' : 'Adición por cuadre de caja';

    await this.applyRecipeDeductions(
      [{ ...orderVenta, cantidad: absDiff } as any],
      tipoMovimiento,
      motivo
    );

    // Emit event
    this.appGateway.emitToVentas(SocketEvent.REFRESH_VENTAS, { action: 'updateEstado', venta: ventaActualizada });

    return ventaActualizada;
  }

  async findAll(query: VentaQueryDto) {
    const { 
      page = 1, 
      limit = 20, 
      estado, 
      usuario, 
      mesa, 
      fechaDesde, 
      fechaHasta, 
      medioDePago, 
      includeDeleted, 
      search,
      totalMin,
      totalMax,
      productoId,
      categoriaProducto,
      clienteId
    } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.VentasWhereInput = {};
    
    // Only filter by deletedAt: null if includeDeleted is not explicitly 'true'
    if (includeDeleted !== 'true' && includeDeleted !== true) {
      where.deletedAt = null;
    } else {
      where.deletedAt = { not: null }; // If includeDeleted is true, we ONLY want deleted ones (for the "Eliminadas" tab)
    }

    if (search) {
      const orConditions: Prisma.VentasWhereInput[] = [];

      // 1. Search for the exact phrase in major fields
      orConditions.push(
        { pedido: { contains: search, mode: 'insensitive' } },
        { cliente: { contains: search, mode: 'insensitive' } },
        { mensaje: { contains: search, mode: 'insensitive' } },
        { ordenVentas: { some: { nombre: { contains: search, mode: 'insensitive' } } } },
        { ordenVentas: { some: { comentarios: { contains: search, mode: 'insensitive' } } } }
      );

      // 2. Search for individual words (length > 2) to be very thorough
      const words = search.split(/\s+/).map(w => w.trim()).filter(w => w.length > 2);
      for (const word of words) {
        orConditions.push(
          { pedido: { contains: word, mode: 'insensitive' } },
          { cliente: { contains: word, mode: 'insensitive' } },
          { mensaje: { contains: word, mode: 'insensitive' } },
          { ordenVentas: { some: { nombre: { contains: word, mode: 'insensitive' } } } },
          { ordenVentas: { some: { comentarios: { contains: word, mode: 'insensitive' } } } }
        );
      }

      // 3. Search for numbers (e.g. totalInput, precioTotal, or strings in comentarios)
      const numberMatches = search.match(/-?\d+([.,]\d+)?/g) || [];
      for (const numStr of numberMatches) {
        let cleanedNumStr = numStr;
        if (/([.,]\d{3})$/.test(numStr)) {
          cleanedNumStr = numStr.replace(/[.]/g, ''); // Remove thousand dot separator
        } else {
          cleanedNumStr = numStr.replace(/,/g, '.'); // Normalize decimal comma to dot
        }
        const parsedNum = parseFloat(cleanedNumStr);
        if (!isNaN(parsedNum)) {
          orConditions.push(
            { totalInput: { equals: parsedNum } },
            { totalInput: { equals: Math.abs(parsedNum) } },
            { ordenVentas: { some: { precioTotal: { equals: parsedNum } } } },
            { ordenVentas: { some: { precioTotal: { equals: Math.abs(parsedNum) } } } },
            { ordenVentas: { some: { precio: { equals: parsedNum } } } },
            { ordenVentas: { some: { precio: { equals: Math.abs(parsedNum) } } } },
            { ordenVentas: { some: { comentarios: { contains: cleanedNumStr, mode: 'insensitive' } } } },
            { ordenVentas: { some: { comentarios: { contains: Math.abs(parsedNum).toString(), mode: 'insensitive' } } } }
          );
        }
      }

      // 4. Special cases: "nota", "notas", "con nota", "con notas"
      const searchLower = search.toLowerCase().trim();
      if (['nota', 'notas', 'con nota', 'con notas', 'comentario', 'comentarios', 'mensaje', 'mensajes'].includes(searchLower)) {
        orConditions.push(
          { AND: [ { mensaje: { not: null } }, { mensaje: { not: "" } } ] },
          { ordenVentas: { some: { AND: [ { comentarios: { not: null } }, { comentarios: { not: "" } } ] } } }
        );
      }

      where.OR = orConditions;
    }

    if (categoriaProducto) {
      where.ordenVentas = {
        ...((where.ordenVentas as any) || {}),
        some: {
          ...(((where.ordenVentas as any)?.some) || {}),
          categoriaProducto: categoriaProducto
        }
      };
    }

    if (estado) {
      where.estado = estado;
    }

    if (usuario) {
      where.usuario = usuario;
    }

    if (mesa) {
      where.mesa = mesa;
    }

    if (medioDePago) {
      where.medioDePago = medioDePago;
    }

    if (fechaDesde || fechaHasta) {
      where.fecha = {};
      if (fechaDesde) {
        where.fecha.gte = new Date(fechaDesde);
      }
      if (fechaHasta) {
        where.fecha.lte = new Date(fechaHasta);
      }
    }

    if (totalMin !== undefined || totalMax !== undefined) {
      where.totalInput = {};
      if (totalMin !== undefined && totalMin !== '') {
        where.totalInput.gte = Number(totalMin);
      }
      if (totalMax !== undefined && totalMax !== '') {
        where.totalInput.lte = Number(totalMax);
      }
    }

    if (productoId || categoriaProducto) {
      where.ordenVentas = {
        some: {
          ...(productoId ? { productoId } : {}),
          ...(categoriaProducto ? { categoria: categoriaProducto } : {})
        }
      };
    }

    if (clienteId) {
      where.clienteId = Number(clienteId);
    }

    const [data, total] = await Promise.all([
      this.prisma.ventas.findMany({
        where,
        skip,
        take: limit,
        orderBy: { fechaYHora: 'desc' },
        include: {
          ordenVentas: {
            include: {
              producto: {
                select: { IDproductos: true, nombre: true, categoriaNombre: true, categoria: true, imagenUrl: true, image: true },
              },
            },
          },
          usuarioRelacion: {
            select: { IDusuarios: true, nombre: true, email: true },
          },
          clienteRelacion: {
            select: { IDcliente: true, nombre: true, cedula: true, whatsapp: true, compras: true, contador: true }
          }
        },
      }),
      this.prisma.ventas.count({ where }),
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
    const venta = await this.prisma.ventas.findFirst({
      where: { IDventas: id, deletedAt: null },
      include: {
        ordenVentas: {
          include: {
            producto: true,
          },
        },
        usuarioRelacion: true,
      },
    });

    if (!venta) {
      throw new NotFoundException(`Venta con ID ${id} no encontrada`);
    }

    return venta;
  }

  async updateEstado(id: string, estado: string) {
    const venta = await this.prisma.ventas.findFirst({
      where: { IDventas: id, deletedAt: null },
    });

    if (!venta) {
      throw new NotFoundException(`Venta con ID ${id} no encontrada`);
    }

    const nuevoRegistro = this.appendTiempoLog(venta.registroDeTiempo, estado);

    await this.prisma.ventas.update({
      where: { IDventas: id },
      data: {
        estado,
        registroDeTiempo: nuevoRegistro
      },
    });

    // FIX: fetch with ordenVentas so the frontend never receives a payload
    // that overwrites the products/totalInput with stale/incomplete data.
    const updated = await this.prisma.ventas.findUnique({
      where: { IDventas: id },
      include: {
        ordenVentas: true,
        usuarioRelacion: { select: { IDusuarios: true, nombre: true, email: true } },
      },
    });

    this.appGateway.emitToVentas(SocketEvent.REFRESH_VENTAS, { action: 'updateEstado', venta: updated });

    return updated;
  }

  async calcularTiempoTotal(id: string) {
    const venta = await this.prisma.ventas.findUnique({
      where: { IDventas: id },
      select: { registroDeTiempo: true, estado: true }
    });

    if (!venta) {
      throw new NotFoundException(`Venta con ID ${id} no encontrada`);
    }

    const log: any[] = Array.isArray(venta.registroDeTiempo) ? venta.registroDeTiempo : [];
    if (log.length === 0) return { tiempoTotalFormat: '00:00:00:00', estadoActual: venta.estado };

    const inicio = new Date(log[0].fecha_hora);
    const fin = log.length > 1 ? new Date(log[log.length - 1].fecha_hora) : new Date();
    
    const diffMs = fin.getTime() - inicio.getTime();

    return {
      tiempoTotalFormat: this.formatDuration(diffMs),
      estadoActual: venta.estado,
      historial: log
    };
  }

  async updatePago(id: string, updateData: any) {
    const venta = await this.prisma.ventas.findFirst({
      where: { IDventas: id, deletedAt: null },
    });

    if (!venta) {
      throw new NotFoundException(`Venta con ID ${id} no encontrada`);
    }

    const nuevoRegistro = this.appendTiempoLog(venta.registroDeTiempo, updateData.estado || 'PAGADO');

    await this.prisma.ventas.update({
      where: { IDventas: id },
      data: {
        estado: updateData.estado || 'PAGADO',
        medioDePago: updateData.medioDePago,
        efectivoRecibido: updateData.efectivoRecibido,
        devueltas: updateData.devueltas,
        banco: updateData.banco,
        totalInput: updateData.totalInput,
        descuento: updateData.descuento,
        porcentajeDeDescuento: updateData.porcentajeDeDescuento,
        registroDeTiempo: nuevoRegistro,
      },
    });

    // FIX: always emit with full ordenVentas to prevent frontend stale-data issues
    const updated = await this.prisma.ventas.findUnique({
      where: { IDventas: id },
      include: {
        ordenVentas: true,
        usuarioRelacion: { select: { IDusuarios: true, nombre: true, email: true } },
      },
    });

    this.appGateway.emitToVentas(SocketEvent.REFRESH_VENTAS, { action: 'updateEstado', venta: updated });
    return updated;
  }

  async addProductosToVenta(id: string, productos: CreateOrderVentaDto[]) {
    const venta = await this.prisma.ventas.findFirst({
      where: { IDventas: id, deletedAt: null },
      include: { ordenVentas: true },
    });

    if (!venta) {
      throw new NotFoundException(`Venta con ID ${id} no encontrada`);
    }

    const newProducts = await Promise.all(
      productos.map((producto) =>
        this.prisma.orderventas.create({
          data: {
            IDventas: id,
            nombre: producto.nombre,
            nombreProducto: producto.nombreProducto || producto.nombre,
            categoria: producto.categoria || 'LO MAS VENDIDO',
            categoriaProducto: producto.categoriaProducto || producto.categoria || 'LO MAS VENDIDO',
            cantidad: producto.cantidad,
            precio: producto.precio,
            precioTotal: producto.precioTotal,
            estado: producto.estado || 'EN_EL_CARRITO',
            productoId: producto.productoId,
            comentarios: producto.comentarios,
            salsa: producto.salsa,
            helado: producto.helado,
            topings: producto.topings,
            imagenUrl: producto.imagenUrl,
          },
        }),
      ),
    );

    const allProducts = [...venta.ordenVentas, ...newProducts];
    const sumProducts = allProducts.reduce((sum, p) => sum + Number(p.precioTotal || 0), 0);
    const newTotal = sumProducts - Number(venta.descuento || 0);

    const updatedVenta = await this.prisma.ventas.update({
      where: { IDventas: id },
      data: { totalInput: newTotal > 0 ? newTotal : 0 },
      include: { ordenVentas: true },
    });

    this.appGateway.emitToVentas(SocketEvent.REFRESH_VENTAS, { action: 'updateEstado', venta: updatedVenta });
    return updatedVenta;
  }

  async findByMesa(mesaId: string) {
    return this.prisma.ventas.findMany({
      where: {
        mesa: mesaId,
        estado: { in: ['EN_EL_CARRITO', 'TOMADO', 'LISTO_PARA_ENTREGA'] },
        deletedAt: null,
      },
      include: {
        ordenVentas: true,
      },
      orderBy: { fechaYHora: 'desc' },
    });
  }

  async findVentasHoy() {
    const hoyContable = await this.getFechaContable(new Date());

    return this.prisma.ventas.findMany({
      where: {
        fecha: hoyContable,
        estado: { in: ['PAGADO', 'ENTREGADO'] },
        deletedAt: null,
      },
      include: {
        ordenVentas: {
          include: {
            producto: {
              select: { IDproductos: true, nombre: true, categoriaNombre: true, categoria: true, imagenUrl: true, image: true },
            },
          },
        },
      },
    });
  }

  async remove(id: string, usuarioId: string, reason?: string) {
    const venta = await this.prisma.ventas.findFirst({
      where: { IDventas: id, deletedAt: null },
    });

    if (!venta) {
      throw new NotFoundException(`Venta con ID ${id} no encontrada`);
    }

    if (venta.estado === 'COMPLETADO' || venta.estado === 'EN_PROCESO') {
      // In a real scenario, check if user has special auth. Here, we assume the Admin guard handles it.
    }

    // Logic to maintain database integrity: When a sale is soft-deleted,
    // we also hard delete its items (Orderventas) so they don't appear in 
    // inventory queries or raw CSV exports as valid active items.
    // If you need them for audit, you could add deletedAt to Orderventas in the future,
    // but currently the easiest robust fix is deleting them.

    const oldOrderventas = await this.prisma.orderventas.findMany({
      where: { IDventas: id },
    });

    // REVERSO DE INVENTARIO
    await this.applyRecipeDeductions(oldOrderventas, 'entrada', 'Reverso por anulación de venta');

    await this.prisma.orderventas.deleteMany({
      where: { IDventas: id },
    });

    const result = await this.prisma.ventas.update({
      where: { IDventas: id },
      data: {
        deletedAt: new Date(),
        deletedBy: usuarioId,
        deleteReason: reason || 'Eliminación manual',
      },
    });

    this.notificationsService.sendNotification(
      'VENTA_DELETED',
      'Venta Eliminada/Anulada',
      `Se ha anulado el pedido ${venta.pedido || id}. Motivo: ${reason || 'Eliminación manual'}`,
      { ventaId: id }
    );

    this.appGateway.emitToVentas(SocketEvent.REFRESH_VENTAS, { action: 'delete', ventaId: id, venta });

    return result;
  }

  async removeBulk(ids: string[], usuarioId: string, reason?: string) {
    // REVERSO DE INVENTARIO PARA TODAS LAS VENTAS
    const oldOrderventas = await this.prisma.orderventas.findMany({
      where: { IDventas: { in: ids } },
    });
    await this.applyRecipeDeductions(oldOrderventas, 'entrada', 'Reverso por anulación masiva');

    // Intelligently clean up child items first
    await this.prisma.orderventas.deleteMany({
      where: { IDventas: { in: ids } },
    });

    const result = await this.prisma.ventas.updateMany({
      where: {
        IDventas: { in: ids },
        deletedAt: null,
      },
      data: {
        deletedAt: new Date(),
        deletedBy: usuarioId,
        deleteReason: reason || 'Eliminación masiva',
      },
    });

    this.appGateway.emitToVentas(SocketEvent.REFRESH_VENTAS, { action: 'bulkDelete', ventaIds: ids, count: result.count });

    return { count: result.count };
  }

  async restore(id: string) {
    const venta = await this.prisma.ventas.findFirst({
      where: { IDventas: id, deletedAt: { not: null } },
    });

    if (!venta) {
      throw new NotFoundException(`Venta eliminada con ID ${id} no encontrada`);
    }

    const orderventas = await this.prisma.orderventas.findMany({
      where: { IDventas: id },
    });

    // DEDUCCIÓN DE INVENTARIO (Vuelve a restar al restaurar)
    await this.applyRecipeDeductions(orderventas, 'salida', 'Descuento por restauración de venta');

    const restored = await this.prisma.ventas.update({
      where: { IDventas: id },
      data: {
        deletedAt: null,
        deletedBy: null,
        deleteReason: null,
      },
    });

    this.appGateway.emitToVentas(SocketEvent.REFRESH_VENTAS, { action: 'restore', venta: restored });

    return restored;
  }

  async hardDelete(id: string) {
    const venta = await this.prisma.ventas.findFirst({
      where: { IDventas: id },
    });

    if (!venta) {
      throw new NotFoundException(`Venta con ID ${id} no encontrada`);
    }

    if (venta.deletedAt === null) {
      const oldOrderventas = await this.prisma.orderventas.findMany({
        where: { IDventas: id },
      });
      await this.applyRecipeDeductions(oldOrderventas, 'entrada', 'Reverso por hard-delete');
    }

    // Intelligently clean up child items first just in case
    await this.prisma.orderventas.deleteMany({
      where: { IDventas: id },
    });

    return this.prisma.ventas.delete({
      where: { IDventas: id },
    });
  }

  async hardDeleteBulk(ids: string[]) {
    const activeVentas = await this.prisma.ventas.findMany({
      where: { IDventas: { in: ids }, deletedAt: null },
    });

    if (activeVentas.length > 0) {
      const activeIds = activeVentas.map(v => v.IDventas);
      const oldOrderventas = await this.prisma.orderventas.findMany({
        where: { IDventas: { in: activeIds } },
      });
      await this.applyRecipeDeductions(oldOrderventas, 'entrada', 'Reverso por hard-delete masivo');
    }

    // Intelligently clean up child items first
    await this.prisma.orderventas.deleteMany({
      where: { IDventas: { in: ids } },
    });

    const result = await this.prisma.ventas.deleteMany({
      where: { IDventas: { in: ids } },
    });

    return { count: result.count };
  }

  async emptyTrash() {
    // Find all soft-deleted ventas
    const deletedVentas = await this.prisma.ventas.findMany({
      where: { deletedAt: { not: null } },
      select: { IDventas: true }
    });
    
    const deletedIds = deletedVentas.map(v => v.IDventas);
    
    if (deletedIds.length > 0) {
      // Clean up child items first
      await this.prisma.orderventas.deleteMany({
        where: { IDventas: { in: deletedIds } },
      });
    }

    const result = await this.prisma.ventas.deleteMany({
      where: { deletedAt: { not: null } },
    });

    if (result.count > 0) {
      this.notificationsService.sendNotification(
        'VENTA_TRASH_EMPTY',
        'Papelera Vaciada',
        `Se han eliminado permanentemente ${result.count} pedidos de la papelera.`,
        {}
      );
    }

    return { message: 'Papelera vaciada correctamente', count: result.count };
  }
}
