import { Injectable, NotFoundException, BadRequestException, Optional, Inject, forwardRef } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateClienteDto, UpdateClienteDto, ClienteQueryDto, ReclamarMisionDto, SincronizarUsuarioDto, EliminarCuentaFidelidadDto, ActualizarCedulaWebDto } from './dto/cliente.dto';
import { Prisma } from '@prisma/client';
import { AppGateway } from '../websocket/app.gateway';
import { AiService } from '../ai/ai.service';
import * as crypto from 'crypto';

@Injectable()
export class ClientesService {
  constructor(
    private prisma: PrismaService,
    @Optional() private appGateway?: AppGateway,
    @Optional() @Inject(forwardRef(() => AiService)) private aiService?: AiService,
  ) {}

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

    if (cedula) {
      const existingCedula = await this.prisma.clientes.findFirst({
        where: {
          cedula: BigInt(cedula),
          isActive: true,
        },
      });
      if (existingCedula) {
        throw new BadRequestException(
          `El número de cédula ${cedula} ya está registrado para el cliente "${existingCedula.nombre || existingCedula.IDcliente}".`
        );
      }
    }

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
        { email: { equals: clean, mode: 'insensitive' } },
      ],
    };

    if (!isNaN(Number(clean))) {
      where.OR!.push({ cedula: { equals: BigInt(clean) } });
      where.OR!.push({ IDcliente: { equals: Number(clean) } });
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
    const obs = cliente.observaciones || '';
    const misionGoogleCompletada = obs.includes('[MISION_GOOGLE_REVIEW_OK]');
    const misionRedesCompletada = obs.includes('[MISION_REDES_SOCIALES_OK]');
    const cedulaBloqueada = obs.includes('[CEDULA_VINCULADA_WEB]');

    return {
      IDcliente: cliente.IDcliente,
      nombre: cliente.nombre || 'Cliente VIP',
      cedula: cliente.cedula ? cliente.cedula.toString() : null,
      cedulaBloqueada,
      whatsapp: cliente.whatsapp || null,
      contador,
      comprasTotales,
      hito5: contador >= 5,
      hito10: contador >= 10,
      granizadoGratis: contador >= 10,
      sellosRestantesParaGranizado: Math.max(0, 10 - contador),
      misionGoogleCompletada,
      misionRedesCompletada,
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

    if (cedula) {
      const existingCedula = await this.prisma.clientes.findFirst({
        where: {
          cedula: BigInt(cedula),
          IDcliente: { not: id },
          isActive: true,
        },
      });
      if (existingCedula) {
        throw new BadRequestException(
          `El número de cédula ${cedula} ya está registrado para otro cliente ("${existingCedula.nombre || existingCedula.IDcliente}").`
        );
      }
    }

    const updated = await this.prisma.clientes.update({
      where: { IDcliente: id },
      data: {
        ...rest,
        ...(cedula !== undefined ? { cedula: cedula ? BigInt(cedula) : null } : {}),
        fecha_y_hora_actualizacion: new Date(),
      },
    });

    if (this.appGateway) {
      try {
        this.appGateway.server.emit('clienteActualizado', {
          IDcliente: updated.IDcliente,
          nombre: updated.nombre,
          cedula: updated.cedula ? updated.cedula.toString() : null,
        });
        this.appGateway.server.emit('ordenActualizada');
      } catch (e) {
        console.warn('Aviso emitiendo socket al actualizar cliente:', e);
      }
    }

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

  async sincronizarUsuario(dto: SincronizarUsuarioDto) {
    const rawEmail = (dto.email || '').trim().toLowerCase();
    if (!rawEmail) {
      throw new BadRequestException('El correo electrónico es requerido para sincronizar el cliente.');
    }

    // 1. Buscar si ya existe un cliente con este email en el ERP
    let cliente = await this.prisma.clientes.findFirst({
      where: {
        email: { equals: rawEmail, mode: 'insensitive' },
      },
    });

    if (cliente) {
      const obs = cliente.observaciones || '';
      return {
        IDcliente: cliente.IDcliente,
        nombre: cliente.nombre || dto.nombre || 'Cliente VIP',
        email: cliente.email,
        contador: cliente.contador || 0,
        comprasTotales: parseInt(cliente.compras || '0', 10) || 0,
        misionGoogleCompletada: obs.includes('[MISION_GOOGLE_REVIEW_OK]'),
        misionRedesCompletada: obs.includes('[MISION_REDES_SOCIALES_OK]'),
        isNew: false,
      };
    }

    // 2. Si no existe, generar código aleatorio de máximo 6 dígitos que no se repita
    let finalId = Math.floor(10000 + Math.random() * 900000); // 10000 a 999999 (máx 6 dígitos)
    let isUnique = false;
    while (!isUnique) {
      const exists = await this.prisma.clientes.findUnique({
        where: { IDcliente: finalId },
      });
      if (!exists) {
        isUnique = true;
      } else {
        finalId = Math.floor(10000 + Math.random() * 900000);
      }
    }

    // 3. Registrar el cliente directamente en el ERP
    const nuevo = await this.prisma.clientes.create({
      data: {
        IDcliente: finalId,
        nombre: dto.nombre?.trim() || 'Cliente VIP',
        email: rawEmail,
        contador: 0,
        compras: '0',
        isActive: true,
        observaciones: 'Cliente registrado desde la web/Google.',
        fecha_y_hora_creacion: new Date(),
      },
    });

    return {
      IDcliente: nuevo.IDcliente,
      nombre: nuevo.nombre,
      email: nuevo.email,
      contador: 0,
      comprasTotales: 0,
      misionGoogleCompletada: false,
      misionRedesCompletada: false,
      isNew: true,
    };
  }

  async eliminarCuentaFidelidad(dto: EliminarCuentaFidelidadDto) {
    const rawEmail = (dto.email || '').trim().toLowerCase();
    const codigo = dto.codigoCliente;

    if (!rawEmail && !codigo) {
      throw new BadRequestException('El correo o código del cliente es requerido.');
    }

    const orConditions: Prisma.ClientesWhereInput[] = [];
    if (rawEmail) {
      orConditions.push({ email: { equals: rawEmail, mode: 'insensitive' } });
    }
    if (codigo) {
      orConditions.push({ IDcliente: Number(codigo) });
    }

    const cliente = await this.prisma.clientes.findFirst({
      where: { OR: orConditions },
    });

    if (!cliente) {
      return {
        success: true,
        message: 'No se encontró registro del cliente en el ERP o ya había sido eliminado.',
      };
    }

    // 1. Desvincular todas las ventas del cliente para PRESERVARLAS (no borrarlas)
    await this.prisma.ventas.updateMany({
      where: { clienteId: cliente.IDcliente },
      data: { clienteId: null },
    });

    // 2. Eliminar el registro del cliente y todos sus sellos en el ERP
    await this.prisma.clientes.delete({
      where: { IDcliente: cliente.IDcliente },
    });

    return {
      success: true,
      message: 'Cuenta y sellos eliminados exitosamente del ERP. Las ventas históricas fueron preservadas.',
    };
  }

  async reclamarMision(dto: ReclamarMisionDto) {
    const rawCedula = (dto.cedula || '').toString().trim().replace(/^#/, '');
    if (!rawCedula && !dto.email) {
      throw new BadRequestException('El código de cliente o correo es obligatorio.');
    }

    const { tipoMision, nombre, whatsapp } = dto;
    if (!['GOOGLE_REVIEW', 'REDES_SOCIALES'].includes(tipoMision)) {
      throw new BadRequestException('Tipo de misión no válido.');
    }

    const tagMision = `[MISION_${tipoMision}_OK]`;

    // Buscar si el cliente ya existe por código (IDcliente), cédula o email
    const orConditions: Prisma.ClientesWhereInput[] = [];
    if (!isNaN(Number(rawCedula))) {
      orConditions.push({ IDcliente: Number(rawCedula) });
      orConditions.push({ cedula: BigInt(rawCedula) });
    }
    if (dto.email) {
      orConditions.push({ email: { equals: dto.email.trim().toLowerCase(), mode: 'insensitive' } });
    }
    if (orConditions.length === 0) {
      orConditions.push({ IDcliente: -1 });
    }

    let cliente = await this.prisma.clientes.findFirst({
      where: { OR: orConditions },
    });

    // Validar si ya reclamó este sello
    if (cliente && cliente.observaciones && cliente.observaciones.includes(tagMision)) {
      throw new BadRequestException(
        tipoMision === 'GOOGLE_REVIEW'
          ? 'Ya has acreditado previamente el sello de la misión de Google Maps.'
          : 'Ya has acreditado previamente el sello de la misión de Redes Sociales.'
      );
    }

    // =========================================================================
    // VALIDACIÓN ANTIFRAUDE E INTELIGENCIA ARTIFICIAL (GEMINI VISION)
    // =========================================================================
    const auditEvidenceTags: string[] = [];

    if (dto.capturas && dto.capturas.length > 0) {
      for (const cap of dto.capturas) {
        if (!cap.base64 || cap.base64.length < 50) continue;

        // 1. Huella digital criptográfica (SHA-256)
        const cleanBase64 = cap.base64.replace(/^data:image\/\w+;base64,/, '');
        const imageHash = crypto.createHash('sha256').update(cleanBase64).digest('hex').substring(0, 16);

        // Validar si este hash ya fue utilizado en el sistema por cualquier cliente
        const hashTag = `HASH:${imageHash}`;
        const dupHash = await this.prisma.clientes.findFirst({
          where: { observaciones: { contains: hashTag } },
        });
        if (dupHash) {
          throw new BadRequestException('Esta captura de pantalla ya fue utilizada anteriormente para reclamar un sello.');
        }

        // 2. Validación con IA (Gemini Vision)
        if (this.aiService) {
          const veredicto = await this.aiService.validarEvidenciaMision(
            cap.base64,
            dto.tipoMision,
            cap.plataforma,
          );

          if (!veredicto.esValida) {
            throw new BadRequestException(veredicto.motivo || 'La captura no cumple los requisitos para acreditar el sello.');
          }

          // 3. Anti-duplicados por hora + batería visible en la captura
          if (veredicto.horaRelojVisible && veredicto.bateriaVisible) {
            const horaBatTag = `HORA_BAT:${veredicto.horaRelojVisible}_${veredicto.bateriaVisible}`;
            const dupHora = await this.prisma.clientes.findFirst({
              where: { observaciones: { contains: horaBatTag } },
            });
            if (dupHora && dupHora.IDcliente !== cliente?.IDcliente) {
              throw new BadRequestException(
                `Se detectó una captura con la misma hora visible (${veredicto.horaRelojVisible}) y batería (${veredicto.bateriaVisible}) ya registrada por otro usuario. Por favor sube una captura propia y reciente.`
              );
            }
            auditEvidenceTags.push(horaBatTag);
          }

          auditEvidenceTags.push(hashTag);
          if (veredicto.horaRelojVisible) {
            auditEvidenceTags.push(`HORA:${veredicto.horaRelojVisible}`);
          }
        } else {
          auditEvidenceTags.push(hashTag);
        }
      }
    } else {
      throw new BadRequestException('Debes adjuntar al menos una captura de pantalla válida como evidencia.');
    }

    const extraAudit = auditEvidenceTags.length > 0 ? ` ${auditEvidenceTags.join(' ')}` : '';

    let finalCliente: any;

    if (cliente) {
      // Cliente existente: sumar 1 sello (contador) y 1 a compras
      const contadorActual = cliente.contador || 0;
      let nuevoContador = contadorActual + 1;
      if (nuevoContador > 10) {
        nuevoContador = 10;
      }
      const comprasActuales = parseInt(cliente.compras || '0', 10) || 0;
      const nuevasCompras = comprasActuales + 1;

      const nota = `${cliente.observaciones ? cliente.observaciones + ' ' : ''}${tagMision}${extraAudit}`;

      finalCliente = await this.prisma.clientes.update({
        where: { IDcliente: cliente.IDcliente },
        data: {
          contador: nuevoContador,
          compras: nuevasCompras.toString(),
          observaciones: nota,
          email: cliente.email || (dto.email ? dto.email.trim().toLowerCase() : null),
          whatsapp: cliente.whatsapp || (whatsapp ? whatsapp.trim() : null),
          nombre: cliente.nombre || (nombre ? nombre.trim() : 'Cliente VIP'),
          fecha_y_hora_actualizacion: new Date(),
        },
      });
    } else {
      // Cliente nuevo: registrar en POS con ID único de 4 a 5 dígitos
      let finalId = Math.floor(1000 + Math.random() * 90000);
      let isUnique = false;
      while (!isUnique) {
        const exists = await this.prisma.clientes.findUnique({
          where: { IDcliente: finalId },
        });
        if (!exists) {
          isUnique = true;
        } else {
          finalId = Math.floor(1000 + Math.random() * 90000);
        }
      }

      finalCliente = await this.prisma.clientes.create({
        data: {
          IDcliente: finalId,
          nombre: nombre && nombre.trim() ? nombre.trim() : 'Cliente Frecuente',
          cedula: !isNaN(Number(rawCedula)) ? BigInt(rawCedula) : null,
          email: dto.email ? dto.email.trim().toLowerCase() : null,
          whatsapp: whatsapp ? whatsapp.trim() : null,
          contador: 1,
          compras: '1',
          observaciones: `${tagMision}${extraAudit} Registrado desde Misiones Web.`,
          isActive: true,
          fecha_y_hora_creacion: new Date(),
        },
      });
    }

    // Emitir en vivo por WebSocket para que la tarjeta se actualice al instante
    if (this.appGateway) {
      try {
        this.appGateway.emitFidelidadActualizada({
          clienteId: finalCliente.IDcliente,
          cedula: finalCliente.cedula ? finalCliente.cedula.toString() : null,
          nombre: finalCliente.nombre,
          contador: finalCliente.contador || 1,
          comprasTotales: parseInt(finalCliente.compras || '1', 10),
          hito5: (finalCliente.contador || 1) >= 5,
          hito10: (finalCliente.contador || 1) >= 10,
          granizadoDisponible: (finalCliente.contador || 1) >= 10,
          descuentoIntermedioDisponible: (finalCliente.contador || 1) >= 5,
          timestamp: new Date().toISOString(),
        });
      } catch (e) {
        // Ignorar fallo de websocket
      }
    }

    return {
      success: true,
      cliente: {
        IDcliente: finalCliente.IDcliente,
        nombre: finalCliente.nombre,
        cedula: finalCliente.cedula ? finalCliente.cedula.toString() : null,
        contador: finalCliente.contador,
        comprasTotales: parseInt(finalCliente.compras || '1', 10),
      },
      mensaje:
        tipoMision === 'GOOGLE_REVIEW'
          ? '¡Felicidades! Se ha acreditado +1 sello a tu tarjeta por tu reseña en Google Maps.'
          : '¡Felicidades! Se ha acreditado +1 sello a tu tarjeta por seguirnos en todas las redes sociales.',
    };
  }

  async actualizarCedulaWeb(dto: ActualizarCedulaWebDto) {
    const rawId = (dto.identificador || '').trim().replace(/^#/, '');
    const cleanCedula = (dto.cedula || '').toString().trim().replace(/\D/g, '');

    if (!rawId) {
      throw new BadRequestException('El identificador del cliente es requerido.');
    }

    if (!cleanCedula || cleanCedula.length < 5 || cleanCedula.length > 15) {
      throw new BadRequestException('El número de cédula debe ser válido (entre 5 y 15 dígitos numéricos).');
    }

    // 1. Buscar al cliente por IDcliente o Email
    const orConditions: Prisma.ClientesWhereInput[] = [];
    if (!isNaN(Number(rawId))) {
      orConditions.push({ IDcliente: Number(rawId) });
    }
    orConditions.push({ email: { equals: rawId, mode: 'insensitive' } });

    const cliente = await this.prisma.clientes.findFirst({
      where: {
        OR: orConditions,
        isActive: true,
      },
    });

    if (!cliente) {
      throw new NotFoundException('Cliente no encontrado con el identificador proporcionado.');
    }

    // 2. Regla: Validar si la cédula ya fue vinculada previamente desde la web (solo 1 vez)
    const obs = cliente.observaciones || '';
    if (obs.includes('[CEDULA_VINCULADA_WEB]')) {
      throw new BadRequestException(
        'Tu número de cédula ya fue registrado anteriormente y no se puede modificar nuevamente desde la web. Si requieres actualizarlo, por favor solicítalo en la caja del restaurante.'
      );
    }

    // 3. Regla: Validar que no existan otros números de cédula iguales
    const cedulaBigInt = BigInt(cleanCedula);
    const clienteExistente = await this.prisma.clientes.findFirst({
      where: {
        cedula: cedulaBigInt,
        IDcliente: { not: cliente.IDcliente },
        isActive: true,
      },
    });

    if (clienteExistente) {
      throw new BadRequestException(
        `El número de cédula ${cleanCedula} ya se encuentra registrado con otro usuario. Si crees que se trata de un error, por favor consúltanos en el restaurante.`
      );
    }

    // 4. Actualizar cédula y marcar etiqueta de bloqueo web
    const nuevaObs = `${obs} [CEDULA_VINCULADA_WEB]`.trim();
    const updated = await this.prisma.clientes.update({
      where: { IDcliente: cliente.IDcliente },
      data: {
        cedula: cedulaBigInt,
        observaciones: nuevaObs,
        fecha_y_hora_actualizacion: new Date(),
      },
    });

    // 5. Emitir evento Socket para refresco en tiempo real
    if (this.appGateway) {
      try {
        this.appGateway.server.emit('clienteActualizado', {
          IDcliente: updated.IDcliente,
          nombre: updated.nombre,
          cedula: cleanCedula,
        });
        this.appGateway.emitFidelidadActualizada({
          clienteId: updated.IDcliente,
          cedula: cleanCedula,
          nombre: updated.nombre,
          contador: updated.contador || 0,
          comprasTotales: parseInt(updated.compras || '0', 10),
          hito5: (updated.contador || 0) >= 5,
          hito10: (updated.contador || 0) >= 10,
          granizadoDisponible: (updated.contador || 0) >= 10,
          descuentoIntermedioDisponible: (updated.contador || 0) >= 5,
          timestamp: new Date().toISOString(),
        });
      } catch (e) {
        console.warn('Aviso emitiendo socket al actualizar cedula:', e);
      }
    }

    return {
      success: true,
      message: 'Cédula vinculada exitosamente a tu tarjeta de fidelidad.',
      IDcliente: updated.IDcliente,
      cedula: cleanCedula,
      cedulaBloqueada: true,
    };
  }
}
