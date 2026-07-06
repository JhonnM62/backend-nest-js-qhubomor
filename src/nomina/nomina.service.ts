import {
  Injectable, NotFoundException, BadRequestException, ForbiddenException
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  RegistrarEntradaDto, RegistrarSalidaDto, UpdateTurnoAdminDto, TurnosQueryDto,
  CreateDescuentoDto, RepartirDescuentoDto, UpdateDescuentoDto, DescuentosQueryDto,
  LiquidarEmpleadoDto
} from './dto/nomina.dto';
import { Prisma } from '@prisma/client';
import * as path from 'path';

// Helper: mapea el día de la semana al campo de tarifa del cargo
const TARIFA_POR_DIA = [
  'tarifaDomingo',   // 0
  'tarifaLunes',     // 1
  'tarifaMartes',    // 2
  'tarifaMiercoles', // 3
  'tarifaJueves',    // 4
  'tarifaViernes',   // 5
  'tarifaSabado',    // 6
] as const;

const HORA_ENTRADA_POR_DIA = [
  'horaEntradaDomingo',
  'horaEntradaLunes',
  'horaEntradaMartes',
  'horaEntradaMiercoles',
  'horaEntradaJueves',
  'horaEntradaViernes',
  'horaEntradaSabado',
] as const;

const HORA_SALIDA_POR_DIA = [
  'horaSalidaDomingo',
  'horaSalidaLunes',
  'horaSalidaMartes',
  'horaSalidaMiercoles',
  'horaSalidaJueves',
  'horaSalidaViernes',
  'horaSalidaSabado',
] as const;

// Helper: distancia en metros entre dos coordenadas (fórmula Haversine)
function calcularDistancia(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000; // radio Tierra en metros
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

@Injectable()
export class NominaService {
  constructor(private prisma: PrismaService) {}

  // ─────────────────────────────────────────────
  // TURNOS
  // ─────────────────────────────────────────────

  async registrarEntrada(usuarioId: string, dto: RegistrarEntradaDto, fotoPath?: string) {
    // Ajuste a hora Colombia (UTC-5)
    const now = new Date();
    const colombiaTime = new Date(now.getTime() - (5 * 60 * 60 * 1000));
    
    const y = colombiaTime.getUTCFullYear();
    const m = colombiaTime.getUTCMonth();
    const d = colombiaTime.getUTCDate();
    const offsetMs = 5 * 60 * 60 * 1000;
    const inicioDiaLocal = new Date(Date.UTC(y, m, d, 0, 0, 0, 0) + offsetMs);

    // Verificar que no haya NINGÚN turno hoy (activo, completado, liquidado...)
    const turnoExistenteHoy = await this.prisma.turnos.findFirst({
      where: {
        usuarioId,
        fecha: { gte: inicioDiaLocal },
      },
    });

    if (turnoExistenteHoy) {
      if (turnoExistenteHoy.estado === 'ACTIVO') {
        throw new BadRequestException('Ya tienes un turno activo hoy. Debes cerrar el turno anterior primero.');
      } else {
        throw new BadRequestException('Ya tienes un turno registrado para el día de hoy. No puedes abrir múltiples turnos en la misma fecha.');
      }
    }

    // Cargar usuario y cargo
    const usuario = await this.prisma.usuarios.findUnique({
      where: { IDusuarios: usuarioId },
      include: { cargo: true },
    });
    if (!usuario) throw new NotFoundException('Usuario no encontrado');

    // Calcular valor del turno según el día de la semana en hora de Colombia
    const diaSemana = colombiaTime.getUTCDay(); // 0=Dom...6=Sáb
    const campoDia = TARIFA_POR_DIA[diaSemana];
    const campoEntrada = HORA_ENTRADA_POR_DIA[diaSemana];
    const campoSalida = HORA_SALIDA_POR_DIA[diaSemana];

    let valorTurno = 0;
    if (usuario.tarifaPersonalizada) {
      valorTurno = Number(usuario.tarifaPersonalizada);
    } else if (usuario.cargo) {
      valorTurno = Number(usuario.cargo[campoDia] ?? 0);
    }

    let minutosRetraso = 0;
    let valorDescuento = 0;

    if (usuario.cargo && usuario.cargo[campoEntrada] && usuario.cargo[campoSalida] && valorTurno > 0) {
      const horaEntradaStr = usuario.cargo[campoEntrada] as string;
      const horaSalidaStr = usuario.cargo[campoSalida] as string;

      const [hEntrada, mEntrada] = horaEntradaStr.split(':').map(Number);
      const [hSalida, mSalida] = horaSalidaStr.split(':').map(Number);

      const minutosEsperados = (hSalida * 60 + mSalida) - (hEntrada * 60 + mEntrada);
      // Ajuste para turnos que cruzan medianoche
      const minutosTotalesEsperados = minutosEsperados < 0 ? minutosEsperados + (24 * 60) : minutosEsperados;

      if (minutosTotalesEsperados > 0) {
        const valorPorMinuto = valorTurno / minutosTotalesEsperados;
        const hActual = colombiaTime.getUTCHours();
        const mActual = colombiaTime.getUTCMinutes();
        const minutosActuales = hActual * 60 + mActual;
        const minutosEntradaEsperada = hEntrada * 60 + mEntrada;
        
        let retraso = minutosActuales - minutosEntradaEsperada;
        if (retraso > 0 && retraso < 12 * 60) {
           minutosRetraso = retraso;
        }

        // Si es mayor al tiempo de gracia, calculamos el descuento desde el primer minuto.
        const confGlobal = await this.prisma.configuracionGlobal.findFirst();
        const TOLERANCIA_MINUTOS = confGlobal?.minutosGraciaLlegadaTarde ?? 5; 
        if (minutosRetraso > TOLERANCIA_MINUTOS) {
           // Opcional: ¿se descuenta el tiempo de gracia? Según el plan: "(restando el tiempo de gracia si aplica, o aplicándolo a la totalidad si superó la gracia)."
           // La respuesta del usuario fue: "(tomaremos la tarifa del día, sacaremos el valor por hora, luego por minuto, y lo multiplicaremos por los minutos de retraso)". 
           // En mi mensaje anterior le dije "descontando los 5 minutos de gracia".
           // Lo descontaré para ser justos:
           const minutosParaCobrar = minutosRetraso - TOLERANCIA_MINUTOS;
           valorDescuento = Math.round(minutosParaCobrar * valorPorMinuto);
        }
      }
    }

    // Calcular geocerca
    let distanciaMetros: number | undefined;
    let dentroGeocerca = true;
    
    const config = await this.prisma.configuracionNegocio.findFirst();
    if (config?.latitudNegocio && config?.longitudNegocio) {
      if (!dto.latitud || !dto.longitud) {
        throw new BadRequestException('La ubicación es obligatoria para registrar el turno.');
      }
      
      distanciaMetros = calcularDistancia(
        dto.latitud, dto.longitud,
        config.latitudNegocio, config.longitudNegocio
      );
      
      const radioPermitido = config.radioGeocercaM || 100;
      dentroGeocerca = distanciaMetros <= radioPermitido;
      
      if (!dentroGeocerca) {
        throw new BadRequestException(`Estás a ${Math.round(distanciaMetros)}m del negocio. El límite permitido es ${radioPermitido}m. No puedes iniciar tu turno desde aquí.`);
      }
    }

    const turno = await this.prisma.turnos.create({
      data: {
        usuarioId,
        fecha: new Date(),
        horaEntrada: new Date(),
        fotoEntrada: fotoPath || null,
        latitud: dto.latitud || null,
        longitud: dto.longitud || null,
        distanciaMetros: distanciaMetros || null,
        dentroGeocerca,
        valorTurno,
        estado: 'ACTIVO',
        observacion: dto.observacion || null,
      },
      include: { usuario: { select: { nombre: true, cargo: true } } },
    });

    if (valorDescuento > 0) {
      const fechaStr = turno.fecha.toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric' });
      await this.prisma.descuentosEmpleado.create({
        data: {
          usuarioId: turno.usuarioId,
          turnoId: turno.IDturno,
          concepto: 'LLEGADA_TARDE',
          descripcion: `Llegada tardía de ${minutosRetraso} minutos en el turno del ${fechaStr}`,
          valor: valorDescuento,
          estado: 'PENDIENTE',
          creadoPor: 'Sistema (automático)',
          fecha: new Date(),
        },
      });
    }

    let mensajeBase = `Turno iniciado correctamente. Valor del turno: $${valorTurno.toLocaleString('es-CO')}`;
    if (valorDescuento > 0) {
      mensajeBase += `. Llegada tardía registrada: ${minutosRetraso} mins, se descontará $${valorDescuento.toLocaleString('es-CO')}.`;
    }

    return {
      success: true,
      data: turno,
      mensaje: mensajeBase,
    };
  }

  async aplicarLlegadasTarde(descuentoIds: string[], adminId: string) {
    if (descuentoIds.length === 0) {
      return { success: true, count: 0, mensaje: 'No se seleccionaron descuentos para aprobar.' };
    }

    const { count } = await this.prisma.descuentosEmpleado.updateMany({
      where: {
        IDdescuento: { in: descuentoIds },
        estado: 'PENDIENTE',
        concepto: 'LLEGADA_TARDE'
      },
      data: {
        estado: 'APROBADO',
        // Opcionalmente podemos registrar quién lo aprobó, pero dejemos creadoPor si no queremos sobreescribir.
      }
    });

    return {
      success: true,
      count,
      mensaje: `Se aprobaron ${count} descuentos por llegada tarde.`
    };
  }

  async registrarSalida(turnoId: string, dto: RegistrarSalidaDto, usuarioSolicitanteId: string, esAdmin: boolean, fotoPath?: string) {
    const turno = await this.prisma.turnos.findUnique({
      where: { IDturno: turnoId },
      include: { usuario: { include: { cargo: true } } },
    });

    if (!turno) throw new NotFoundException('Turno no encontrado');
    if (turno.estado !== 'ACTIVO') {
      throw new BadRequestException('Este turno ya fue cerrado o está anulado');
    }

    // Solo el empleado dueño o un admin puede cerrar el turno
    if (!esAdmin && turno.usuarioId !== usuarioSolicitanteId) {
      throw new ForbiddenException('Solo puedes cerrar tu propio turno');
    }

    // Calcular geocerca para salida
    let distanciaMetrosSalida: number | undefined;
    let dentroGeocercaSalida = true;
    
    const config = await this.prisma.configuracionNegocio.findFirst();
    if (config?.latitudNegocio && config?.longitudNegocio) {
      if (!dto.latitud || !dto.longitud) {
        if (!esAdmin) {
          throw new BadRequestException('La ubicación es obligatoria para cerrar el turno.');
        }
      } else {
        distanciaMetrosSalida = calcularDistancia(
          dto.latitud, dto.longitud,
          config.latitudNegocio, config.longitudNegocio
        );
        
        const radioPermitido = config.radioGeocercaM || 100;
        dentroGeocercaSalida = distanciaMetrosSalida <= radioPermitido;
        
        if (!dentroGeocercaSalida && !esAdmin) {
          if (!dto.observacion || dto.observacion.length < 10) {
            throw new BadRequestException(`Estás a ${Math.round(distanciaMetrosSalida)}m del negocio. Para cerrar el turno fuera del rango permitido (${radioPermitido}m), es OBLIGATORIO ingresar una justificación válida (mínimo 10 caracteres).`);
          }
        }
      }
    }

    // Actualizar el turno con la salida y el campo cenó
    // Forzamos evaluación estricta a booleano, ya que form-data puede enviar strings como "false"
    const isCeno = dto.ceno === true || String(dto.ceno) === 'true';

    const turnoActualizado = await this.prisma.turnos.update({
      where: { IDturno: turnoId },
      data: {
        horaSalida: new Date(),
        ceno: isCeno,
        estado: 'COMPLETADO',
        observacion: dto.observacion || null,
        fotoSalida: fotoPath || null,
        latitudSalida: dto.latitud || null,
        longitudSalida: dto.longitud || null,
        distanciaMetrosSalida: distanciaMetrosSalida || null,
        dentroGeocercaSalida: dentroGeocercaSalida ?? null,
      },
    });

    // Si cenó y el cargo tiene descuento de cena, crear descuento automático
    if (isCeno && turno.usuario.cargo) {
      const descuentoCena = Number(turno.usuario.cargo.descuentoCena || 0);
      if (descuentoCena > 0) {
        const fechaStr = turno.fecha.toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric' });
        await this.prisma.descuentosEmpleado.create({
          data: {
            usuarioId: turno.usuarioId,
            turnoId: turno.IDturno,
            concepto: 'CENA',
            descripcion: `Cena del turno del ${fechaStr}`,
            valor: descuentoCena,
            estado: 'APROBADO',
            creadoPor: 'Sistema (automático)',
            fecha: new Date(),
          },
        });
      }
    }

    let mensajeRespuesta = isCeno
      ? 'Turno cerrado. Se registró la cena y se aplicó el descuento correspondiente.'
      : 'Turno finalizado correctamente';

    return {
      success: true,
      data: turnoActualizado,
      mensaje: mensajeRespuesta,
    };
  }

  async getTurnos(query: TurnosQueryDto) {
    const { page = 1, limit = 50, usuarioId, fechaDesde, fechaHasta, estado } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.TurnosWhereInput = {};
    if (usuarioId) where.usuarioId = usuarioId;
    if (estado) where.estado = estado;
    if (fechaDesde || fechaHasta) {
      where.fecha = {};
      if (fechaDesde) (where.fecha as any).gte = new Date(fechaDesde);
      if (fechaHasta) (where.fecha as any).lte = new Date(fechaHasta);
    }

    const [data, total] = await Promise.all([
      this.prisma.turnos.findMany({
        where, skip, take: limit,
        orderBy: { horaEntrada: 'desc' },
        include: {
          usuario: { select: { nombre: true, rol: true, cargo: { select: { nombre: true, descuentoCena: true } } } },
          descuentos: true,
          _count: { select: { descuentos: true } },
        },
      }),
      this.prisma.turnos.count({ where }),
    ]);

    const dataConDescuentosExtras = await Promise.all(data.map(async (turno) => {
      // Obtenemos la fecha local en Colombia (UTC-5) basada en la hora de entrada real
      const shiftDateLocal = new Date(turno.horaEntrada.getTime() - (5 * 60 * 60 * 1000));
      
      const y = shiftDateLocal.getUTCFullYear();
      const m = shiftDateLocal.getUTCMonth();
      const d = shiftDateLocal.getUTCDate();

      // Ajustamos los límites del día a la hora de Colombia. (00:00 local = 05:00 UTC)
      const startOfDayUTC = new Date(Date.UTC(y, m, d, 5, 0, 0, 0));
      const endOfDayUTC = new Date(Date.UTC(y, m, d + 1, 4, 59, 59, 999));
      
      const extraDescuentos = await this.prisma.descuentosEmpleado.findMany({
        where: {
          usuarioId: turno.usuarioId,
          fecha: {
            gte: startOfDayUTC,
            lte: endOfDayUTC,
          },
          turnoId: null,
        }
      });
      return {
        ...turno,
        descuentos: [...turno.descuentos, ...extraDescuentos]
      };
    }));

    return {
      data: dataConDescuentosExtras,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async getMisTurnos(usuarioId: string, query: TurnosQueryDto) {
    return this.getTurnos({ ...query, usuarioId });
  }

  async getTurno(turnoId: string) {
    const turno = await this.prisma.turnos.findUnique({
      where: { IDturno: turnoId },
      include: {
        usuario: { select: { nombre: true, cargo: true } },
        descuentos: true,
      },
    });
    if (!turno) throw new NotFoundException('Turno no encontrado');
    return turno;
  }

  async updateTurnoAdmin(turnoId: string, dto: UpdateTurnoAdminDto) {
    const turno = await this.getTurno(turnoId);
    const updateData: any = { ...dto };
    if (dto.horaSalida) updateData.horaSalida = new Date(dto.horaSalida);
    if (dto.horaEntrada) updateData.horaEntrada = new Date(dto.horaEntrada);
    // Si se está cerrando el turno (COMPLETADO) y aún no tiene horaSalida, asignamos la hora actual
    if (dto.estado === 'COMPLETADO' && !dto.horaSalida && !updateData.horaSalida) {
      updateData.horaSalida = new Date();
    }

    // Gestionar creación/eliminación de descuento de cena si cambia el estado
    if (dto.ceno !== undefined) {
      const isCeno = dto.ceno === true || String(dto.ceno) === 'true';
      updateData.ceno = isCeno;
      
      // Si antes NO había cenado y ahora SÍ, y hay descuento en el cargo
      if (isCeno && !turno.ceno) {
        const descuentoCena = Number(turno.usuario.cargo?.descuentoCena || 0);
        if (descuentoCena > 0) {
          const fechaStr = turno.fecha.toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric' });
          await this.prisma.descuentosEmpleado.create({
            data: {
              usuarioId: turno.usuarioId,
              turnoId: turno.IDturno,
              concepto: 'CENA',
              descripcion: `Cena del turno del ${fechaStr}`,
              valor: descuentoCena,
              estado: 'APROBADO',
              creadoPor: 'Admin',
              fecha: new Date(),
            },
          });
        }
      } 
      // Si antes SÍ había cenado y ahora NO, eliminamos el descuento de CENA asociado a este turno
      else if (!isCeno && turno.ceno) {
        await this.prisma.descuentosEmpleado.deleteMany({
          where: {
            turnoId: turnoId,
            concepto: 'CENA',
          }
        });
      }
    }

    const updated = await this.prisma.turnos.update({
      where: { IDturno: turnoId },
      data: updateData,
    });
    return { success: true, data: updated };
  }

  async deleteTurno(turnoId: string) {
    await this.getTurno(turnoId); // Check if it exists
    await this.prisma.turnos.delete({
      where: { IDturno: turnoId }
    });
    return { success: true, mensaje: 'Turno eliminado correctamente' };
  }

  async getTurnoActivoDelDia(usuarioId: string) {
    // NOTA: No filtramos por fecha porque el servidor corre en UTC.
    // A las 11:30 PM en Colombia (UTC-5), el servidor ya está en el siguiente día UTC,
    // por lo que filtrar por fecha rompe la búsqueda. Como un usuario solo puede tener
    // UN turno ACTIVO a la vez, buscar únicamente por estado es correcto y seguro.
    const turno = await this.prisma.turnos.findFirst({
      where: { usuarioId, estado: 'ACTIVO' },
      include: { usuario: { select: { nombre: true, cargo: { select: { nombre: true } } } } },
    });
    return { data: turno, tieneActivo: !!turno };
  }

  // ─────────────────────────────────────────────
  // DESCUENTOS
  // ─────────────────────────────────────────────

  async createDescuento(dto: CreateDescuentoDto, creadoPor: string) {
    const usuario = await this.prisma.usuarios.findUnique({ where: { IDusuarios: dto.usuarioId } });
    if (!usuario) throw new NotFoundException('Empleado no encontrado');

    const descuento = await this.prisma.descuentosEmpleado.create({
      data: {
        ...dto,
        fecha: new Date(),
        estado: 'PENDIENTE',
        creadoPor,
      },
    });
    return { success: true, data: descuento };
  }

  async repartirDescuento(dto: RepartirDescuentoDto, creadoPor: string) {
    // Verificar que todos los usuarios existen
    const usuarios = await this.prisma.usuarios.findMany({
      where: { IDusuarios: { in: dto.usuarioIds } },
    });
    if (usuarios.length !== dto.usuarioIds.length) {
      throw new BadRequestException('Uno o más empleados seleccionados no existen');
    }

    const montoIndividual = Math.round(Number(dto.montoTotal) / dto.usuarioIds.length);
    const loteId = require('crypto').randomUUID();

    const descuentos = await this.prisma.$transaction(
      dto.usuarioIds.map(uid =>
        this.prisma.descuentosEmpleado.create({
          data: {
            usuarioId: uid,
            turnoId: dto.turnoId || null,
            loteId,
            concepto: dto.concepto,
            descripcion: dto.descripcion,
            valor: montoIndividual,
            estado: 'PENDIENTE',
            creadoPor,
            fecha: dto.fecha ? new Date(dto.fecha) : new Date(),
          },
        })
      )
    );

    return {
      success: true,
      data: descuentos,
      resumen: {
        montoTotal: dto.montoTotal,
        empleados: dto.usuarioIds.length,
        montoIndividual,
        loteId,
      },
    };
  }

  async getDescuentos(query: DescuentosQueryDto) {
    const { page = 1, limit = 50, usuarioId, estado, fechaDesde, fechaHasta } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.DescuentosEmpleadoWhereInput = {};
    if (usuarioId) where.usuarioId = usuarioId;
    if (estado) where.estado = estado;
    if (fechaDesde || fechaHasta) {
      where.fecha = {};
      if (fechaDesde) (where.fecha as any).gte = new Date(fechaDesde);
      if (fechaHasta) (where.fecha as any).lte = new Date(fechaHasta);
    }

    const [data, total] = await Promise.all([
      this.prisma.descuentosEmpleado.findMany({
        where, skip, take: limit,
        orderBy: { createdAt: 'desc' },
        include: { usuario: { select: { nombre: true } } },
      }),
      this.prisma.descuentosEmpleado.count({ where }),
    ]);

    return { data, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
  }

  async getMisDescuentos(usuarioId: string, query: DescuentosQueryDto) {
    return this.getDescuentos({ ...query, usuarioId });
  }

  async marcarDescuentoVisto(descuentoId: string, usuarioId: string) {
    const descuento = await this.prisma.descuentosEmpleado.findUnique({
      where: { IDdescuento: descuentoId },
    });
    if (!descuento) throw new NotFoundException('Descuento no encontrado');
    if (descuento.usuarioId !== usuarioId) {
      throw new ForbiddenException('No puedes marcar como visto un descuento que no es tuyo');
    }
    if (descuento.estado === 'APROBADO') {
      throw new BadRequestException('Este descuento ya fue aprobado y no puede modificarse');
    }

    const updated = await this.prisma.descuentosEmpleado.update({
      where: { IDdescuento: descuentoId },
      data: { estado: 'VISTO' },
    });
    return { success: true, data: updated };
  }

  async updateDescuento(descuentoId: string, dto: UpdateDescuentoDto) {
    const descuento = await this.prisma.descuentosEmpleado.findUnique({
      where: { IDdescuento: descuentoId },
    });
    if (!descuento) throw new NotFoundException('Descuento no encontrado');

    const updated = await this.prisma.descuentosEmpleado.update({
      where: { IDdescuento: descuentoId },
      data: dto,
    });
    return { success: true, data: updated };
  }

  async deleteDescuento(descuentoId: string) {
    const descuento = await this.prisma.descuentosEmpleado.findUnique({
      where: { IDdescuento: descuentoId },
    });
    if (!descuento) throw new NotFoundException('Descuento no encontrado');

    await this.prisma.descuentosEmpleado.delete({ where: { IDdescuento: descuentoId } });
    return { success: true, message: 'Descuento eliminado correctamente' };
  }

  // ─────────────────────────────────────────────
  // RESUMEN (para dashboard)
  // ─────────────────────────────────────────────

  async getResumenEmpleado(usuarioId: string, fechaDesde?: string, fechaHasta?: string) {
    const usuario = await this.prisma.usuarios.findUnique({
      where: { IDusuarios: usuarioId },
      select: { nombre: true, cargo: true, tarifaPersonalizada: true },
    });
    if (!usuario) throw new NotFoundException('Empleado no encontrado');

    const fechaFiltro: any = {};
    if (fechaDesde) fechaFiltro.gte = new Date(fechaDesde);
    if (fechaHasta) fechaFiltro.lte = new Date(fechaHasta);

    const [turnos, descuentos] = await Promise.all([
      this.prisma.turnos.findMany({
        where: {
          usuarioId,
          estado: 'COMPLETADO',
          ...(Object.keys(fechaFiltro).length ? { fecha: fechaFiltro } : {}),
        },
        orderBy: { fecha: 'desc' },
      }),
      this.prisma.descuentosEmpleado.findMany({
        where: {
          usuarioId,
          ...(Object.keys(fechaFiltro).length ? { fecha: fechaFiltro } : {}),
        },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    const totalBruto = turnos.reduce((sum: number, t: any) => sum + Number(t.valorTurno), 0);
    const totalDescuentos = descuentos.reduce((sum: number, d: any) => sum + (d.concepto === 'LLEGADA_TARDE' && d.estado === 'PENDIENTE' ? 0 : Number(d.valor)), 0);
    const totalNeto = totalBruto - totalDescuentos;

    return {
      success: true,
      data: {
        usuario,
        totalTurnos: turnos.length,
        totalBruto,
        totalDescuentos,
        totalNeto,
        turnos,
        descuentos,
      },
    };
  }

  // ─────────────────────────────────────────────
  // LIQUIDACIONES
  // ─────────────────────────────────────────────

  async liquidarEmpleado(dto: LiquidarEmpleadoDto, creadoPor: string) {
    const usuario = await this.prisma.usuarios.findUnique({ where: { IDusuarios: dto.usuarioId } });
    if (!usuario) throw new NotFoundException('Empleado no encontrado');

    const fechaInicio = new Date(dto.fechaInicio);
    const fechaFin = new Date(dto.fechaFin);
    fechaFin.setHours(23, 59, 59, 999);

    // Obtener turnos completados en el período
    const turnos = await this.prisma.turnos.findMany({
      where: {
        usuarioId: dto.usuarioId,
        estado: 'COMPLETADO',
        fecha: { gte: fechaInicio, lte: fechaFin },
      },
    });

    // Obtener descuentos en el período
    const descuentos = await this.prisma.descuentosEmpleado.findMany({
      where: {
        usuarioId: dto.usuarioId,
        fecha: { gte: fechaInicio, lte: fechaFin },
      },
    });

    const totalBruto = turnos.reduce((sum: number, t: any) => sum + Number(t.valorTurno), 0);
    const totalDescuentos = descuentos.reduce((sum: number, d: any) => sum + (d.concepto === 'LLEGADA_TARDE' && d.estado === 'PENDIENTE' ? 0 : Number(d.valor)), 0);
    const totalNeto = totalBruto - totalDescuentos;

    const liquidacion = await this.prisma.liquidaciones.create({
      data: {
        usuarioId: dto.usuarioId,
        fechaInicio,
        fechaFin,
        totalTurnos: turnos.length,
        totalBruto,
        totalDescuentos,
        totalNeto,
        estado: 'PENDIENTE',
        observaciones: dto.observaciones || null,
        creadoPor,
        turnosDetalle: turnos as any,
        descuentosDetalle: descuentos as any,
      },
      include: { usuario: { select: { nombre: true, cargo: true } } },
    });

    return {
      success: true,
      data: liquidacion,
      mensaje: `Liquidación generada: $${totalNeto.toLocaleString('es-CO')} a pagar a ${usuario.nombre}`,
    };
  }

  async getLiquidaciones(usuarioId?: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const where: Prisma.LiquidacionesWhereInput = usuarioId ? { usuarioId } : {};

    const [data, total] = await Promise.all([
      this.prisma.liquidaciones.findMany({
        where, skip, take: limit,
        orderBy: { createdAt: 'desc' },
        include: { usuario: { select: { nombre: true, cargo: { select: { nombre: true } } } } },
      }),
      this.prisma.liquidaciones.count({ where }),
    ]);

    return { data, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
  }

  async getLiquidacion(id: string) {
    const liquidacion = await this.prisma.liquidaciones.findUnique({
      where: { IDliquidacion: id },
      include: { usuario: { select: { nombre: true, cargo: true, cedula: true } } },
    });
    if (!liquidacion) throw new NotFoundException('Liquidación no encontrada');
    return liquidacion;
  }

  async marcarLiquidacionPagada(id: string) {
    const liquidacion = await this.getLiquidacion(id);
    if ((liquidacion as any).estado === 'PAGADA') {
      throw new BadRequestException('Esta liquidación ya fue marcada como pagada');
    }
    const updated = await this.prisma.liquidaciones.update({
      where: { IDliquidacion: id },
      data: { estado: 'PAGADA' },
    });
    return { success: true, data: updated };
  }

  // ─────────────────────────────────────────────
  // RECÁLCULO
  // ─────────────────────────────────────────────
  async recalcularTurnosEmpleado(usuarioId: string) {
    const usuario = await this.prisma.usuarios.findUnique({
      where: { IDusuarios: usuarioId },
      include: { cargo: true },
    });

    if (!usuario) throw new NotFoundException('Usuario no encontrado');
    if (!usuario.cargo && !usuario.tarifaPersonalizada) {
      throw new BadRequestException('El usuario no tiene un cargo asignado ni tarifa personalizada. No se puede recalcular.');
    }

    // Buscar turnos en $0 de este empleado
    const turnosEnCero = await this.prisma.turnos.findMany({
      where: {
        usuarioId,
        valorTurno: 0,
      }
    });

    if (turnosEnCero.length === 0) {
      return { success: true, mensaje: 'No se encontraron turnos con valor $0 para este empleado.' };
    }

    let actualizados = 0;

    for (const turno of turnosEnCero) {
      const entrada = new Date(turno.horaEntrada);
      // Ajustar a UTC-5 (hora de Colombia) para obtener el día real
      const colombiaTime = new Date(entrada.getTime() - (5 * 60 * 60 * 1000));
      const diaSemana = colombiaTime.getUTCDay();
      const campoDia = TARIFA_POR_DIA[diaSemana];

      let nuevoValor = 0;
      if (usuario.tarifaPersonalizada) {
        nuevoValor = Number(usuario.tarifaPersonalizada);
      } else if (usuario.cargo) {
        nuevoValor = Number(usuario.cargo[campoDia] ?? 0);
      }

      if (nuevoValor > 0) {
        await this.prisma.turnos.update({
          where: { IDturno: turno.IDturno },
          data: { valorTurno: nuevoValor },
        });
        actualizados++;
      }
    }

    return { 
      success: true, 
      mensaje: `Se recalcularon ${actualizados} turnos correctamente.` 
    };
  }
}
