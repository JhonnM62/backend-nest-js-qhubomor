import { Injectable, NotFoundException, BadRequestException, ForbiddenException, Inject, forwardRef } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AppGateway } from '../websocket/app.gateway';
import {
  RegistrarEntradaDto, RegistrarSalidaDto, UpdateTurnoAdminDto, TurnosQueryDto,
  CreateDescuentoDto, RepartirDescuentoDto, UpdateDescuentoDto, DescuentosQueryDto,
  LiquidarEmpleadoDto, CreateTurnoManualDto
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
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
    @Inject(forwardRef(() => AppGateway)) private readonly appGateway: AppGateway
  ) {}

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

    // Verificar que no haya un turno ACTIVO hoy (usando rango de fecha para evitar problemas de zona horaria)
    // El rango cubre desde las 00:00 hasta las 23:59 hora Colombia (UTC-5)
    const fechaAInsertar = new Date(Date.UTC(y, m, d, 0, 0, 0, 0));
    const inicioDiaUTC = new Date(Date.UTC(y, m, d, 5, 0, 0, 0));    // 00:00 Colombia = 05:00 UTC
    const finDiaUTC    = new Date(Date.UTC(y, m, d + 1, 5, 0, 0, 0)); // 00:00 Colombia del día siguiente = 05:00 UTC del día siguiente

    const turnoExistenteHoy = await this.prisma.turnos.findFirst({
      where: {
        usuarioId,
        horaEntrada: {
          gte: inicioDiaUTC,
          lt:  finDiaUTC,
        },
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

    let valorTurno = 0;
    let horaEntradaStr: string | null = null;
    let horaSalidaStr: string | null = null;
    let isExcepcion = false;

    if (usuario.cargo) {
      const excepcion = await this.prisma.excepcionHorarioCargo.findFirst({
        where: {
          cargoId: usuario.cargo.IDcargo,
          fecha: fechaAInsertar,
        }
      });
      if (excepcion) {
        isExcepcion = true;
        valorTurno = Number(excepcion.tarifa);
        horaEntradaStr = excepcion.horaEntrada;
        horaSalidaStr = excepcion.horaSalida;
      }
    }

    if (!isExcepcion) {
      const diaSemana = colombiaTime.getUTCDay(); // 0=Dom...6=Sáb
      const campoDia = TARIFA_POR_DIA[diaSemana];
      const campoEntrada = HORA_ENTRADA_POR_DIA[diaSemana];
      const campoSalida = HORA_SALIDA_POR_DIA[diaSemana];
      
      if (usuario.cargo) {
        valorTurno = Number(usuario.cargo[campoDia] ?? 0);
        horaEntradaStr = usuario.cargo[campoEntrada] as string;
        horaSalidaStr = usuario.cargo[campoSalida] as string;
      }
    }

    if (usuario.tarifaPersonalizada) {
      valorTurno = Number(usuario.tarifaPersonalizada);
    }

    let minutosRetraso = 0;
    let valorDescuento = 0;
    let descLlegadaTarde = '';

    if (horaEntradaStr && horaSalidaStr && valorTurno > 0) {

      const parseTimeStr = (t: string) => {
        const match = t.trim().match(/^(\d{1,2}):(\d{2})(?:\s*(AM|PM|am|pm))?$/);
        if (!match) return { h: 0, m: 0 };
        let h = parseInt(match[1], 10);
        const m = parseInt(match[2], 10);
        const p = match[3] ? match[3].toUpperCase() : null;
        if (p === 'PM' && h < 12) h += 12;
        if (p === 'AM' && h === 12) h = 0;
        return { h, m };
      };

      const { h: hEntrada, m: mEntrada } = parseTimeStr(horaEntradaStr);
      const { h: hSalida, m: mSalida } = parseTimeStr(horaSalidaStr);

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

        const confNegocio = await this.prisma.configuracionNegocio.findFirst();
        const TOLERANCIA_MINUTOS = (confNegocio as any)?.minutosGraciaLlegadaTarde ?? 5; 
        if (minutosRetraso > TOLERANCIA_MINUTOS) {
           const minutosParaCobrar = minutosRetraso - TOLERANCIA_MINUTOS;
           valorDescuento = Math.round(minutosParaCobrar * valorPorMinuto);

           const formatTime = (h: number, m: number) => {
             const ampm = h >= 12 ? 'PM' : 'AM';
             let h12 = h % 12;
             if (h12 === 0) h12 = 12;
             return `${h12.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')} ${ampm}`;
           };
           const strEsperada = formatTime(hEntrada, mEntrada);
           const strLlegada = formatTime(hActual, mActual);
           const tarifaMin = valorPorMinuto.toLocaleString('es-CO', { maximumFractionDigits: 1 });
           const tarifaHora = Math.round(valorPorMinuto * 60).toLocaleString('es-CO');

           descLlegadaTarde = `Llegada: ${strLlegada} (Horario: ${strEsperada}). Retraso total: ${minutosRetraso} min. Gracia: -${TOLERANCIA_MINUTOS} min. Penalizados: ${minutosParaCobrar} min a $${tarifaMin}/min ($${tarifaHora}/h).`;
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
        fecha: fechaAInsertar,
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
          descripcion: descLlegadaTarde || `Llegada tardía de ${minutosRetraso} minutos en el turno del ${fechaStr}`,
          valor: valorDescuento,
          estado: 'PENDIENTE',
          creadoPor: 'Sistema (automático)',
          fecha: turno.fecha,
        },
      });
    }

    let mensajeBase = `Turno iniciado correctamente. Valor del turno: $${valorTurno.toLocaleString('es-CO')}`;
    if (valorDescuento > 0) {
      mensajeBase += `. Llegada tardía registrada: ${minutosRetraso} mins, se descontará $${valorDescuento.toLocaleString('es-CO')}.`;
    }

    let pushBody = `El empleado ${turno.usuario.nombre} ha abierto su turno.`;
    if (minutosRetraso > 0) {
      pushBody += ` Llegó ${minutosRetraso} minutos tarde.`;
    }

    // Enviar notificación a los administradores
    await this.notificationsService.sendNotification(
      'TURNO_OPENED',
      'Turno Iniciado',
      pushBody,
      { turnoId: turno.IDturno, usuarioId }
    );

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

  async iniciarDescanso(turnoId: string, usuarioId: string) {
    const turno = await this.prisma.turnos.findUnique({ where: { IDturno: turnoId } });
    if (!turno) throw new NotFoundException('Turno no encontrado');
    if (turno.usuarioId !== usuarioId) throw new ForbiddenException('Solo puedes gestionar tu propio turno');
    if (turno.estado !== 'ACTIVO') throw new BadRequestException('El turno no está activo');
    if (turno.inicioDescanso) throw new BadRequestException('El descanso ya fue iniciado');

    const updated = await this.prisma.turnos.update({
      where: { IDturno: turnoId },
      data: { inicioDescanso: new Date() },
    });
    return { success: true, data: updated, mensaje: 'Descanso iniciado correctamente' };
  }

  async terminarDescanso(turnoId: string, usuarioId: string) {
    const turno = await this.prisma.turnos.findUnique({ where: { IDturno: turnoId } });
    if (!turno) throw new NotFoundException('Turno no encontrado');
    if (turno.usuarioId !== usuarioId) throw new ForbiddenException('Solo puedes gestionar tu propio turno');
    if (!turno.inicioDescanso) throw new BadRequestException('No se ha iniciado el descanso');
    if (turno.finDescanso) throw new BadRequestException('El descanso ya fue terminado');

    const updated = await this.prisma.turnos.update({
      where: { IDturno: turnoId },
      data: { finDescanso: new Date() },
    });
    return { success: true, data: updated, mensaje: 'Descanso terminado correctamente' };
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
    const isCeno = dto.ceno === true || String(dto.ceno).toLowerCase() === 'true' || String(dto.ceno) === '1';

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
        const existeCena = await this.prisma.descuentosEmpleado.findFirst({
          where: { turnoId: turno.IDturno, concepto: 'CENA' }
        });
        if (!existeCena) {
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
    }

    let mensajeRespuesta = isCeno
      ? 'Turno cerrado. Se registró la cena y se aplicó el descuento correspondiente.'
      : 'Turno finalizado correctamente';

    // Enviar notificación a los administradores
    await this.notificationsService.sendNotification(
      'TURNO_CLOSED',
      'Turno Finalizado',
      `El empleado ${turno.usuario.nombre} ha cerrado su turno.`,
      { turnoId: turno.IDturno, usuarioId: turno.usuarioId }
    );

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

  async crearTurnoManual(dto: CreateTurnoManualDto) {
    const usuario = await this.prisma.usuarios.findUnique({
      where: { IDusuarios: dto.usuarioId },
      include: { cargo: true }
    });
    if (!usuario) throw new NotFoundException('Usuario no encontrado');

    // Obtener la ubicación por defecto del negocio
    const config = await this.prisma.configuracionNegocio.findFirst();
    const latitud = Number(config?.latitudNegocio) || 0;
    const longitud = Number(config?.longitudNegocio) || 0;

    const turnosCreados = [];

    for (const fechaStr of dto.fechas) {
      // Create local date around noon to avoid timezone shift on the date part
      const [y, m, d] = fechaStr.split('-');
      const fecha = new Date(Number(y), Number(m) - 1, Number(d), 12, 0, 0);

      // Parse times
      const parseTime = (timeStr: string, dateObj: Date) => {
        // timeStr like "08:00 AM" or "14:30"
        const [time, modifier] = timeStr.split(' ');
        let [hours, minutes] = time.split(':');
        let h = parseInt(hours, 10);
        if (modifier === 'PM' && h < 12) h += 12;
        if (modifier === 'AM' && h === 12) h = 0;
        const dt = new Date(dateObj);
        dt.setHours(h, parseInt(minutes, 10), 0, 0);
        return dt;
      };

      const hEntrada = parseTime(dto.horaEntrada, fecha);
      let hSalida = null;
      let estado = 'ACTIVO';
      let valorTurno = 0;

      if (dto.horaSalida) {
        hSalida = parseTime(dto.horaSalida, fecha);
        estado = 'COMPLETADO';
        const horasTrabajadas = (hSalida.getTime() - hEntrada.getTime()) / (1000 * 60 * 60);

        const diaSemana = fecha.getDay();
        const campoDia = TARIFA_POR_DIA[diaSemana];
        valorTurno = Number(usuario.cargo?.[campoDia] ?? 0);
      }

      const t = await this.prisma.turnos.create({
        data: {
          usuarioId: dto.usuarioId,
          fecha,
          horaEntrada: hEntrada,
          horaSalida: hSalida,
          estado,
          valorTurno,
          latitud,
          longitud,
          ceno: false, // Default no cenó
        }
      });
      turnosCreados.push(t);
    }

    return {
      success: true,
      data: turnosCreados,
      mensaje: `Se crearon ${turnosCreados.length} turnos exitosamente.`
    };
  }

  async updateTurnoAdmin(turnoId: string, dto: UpdateTurnoAdminDto) {
    const turno = await this.getTurno(turnoId);
    const updateData: any = { ...dto };
    if (dto.horaSalida) updateData.horaSalida = new Date(dto.horaSalida);
    if (dto.horaEntrada) updateData.horaEntrada = new Date(dto.horaEntrada);
    // Si se está cerrando el turno (COMPLETADO o FINALIZADO) y aún no tiene horaSalida, asignamos la hora actual
    if (dto.estado === 'COMPLETADO' && !dto.horaSalida && !updateData.horaSalida) {
      updateData.horaSalida = new Date();
    }

    // Gestionar creación/eliminación de descuento de cena si cambia el estado
    if (dto.ceno !== undefined) {
      const isCeno = dto.ceno === true || String(dto.ceno).toLowerCase() === 'true' || String(dto.ceno) === '1';
      updateData.ceno = isCeno;
      
      // Si antes NO había cenado y ahora SÍ, y hay descuento en el cargo
      if (isCeno && !turno.ceno) {
        const descuentoCena = Number(turno.usuario.cargo?.descuentoCena || 0);
        if (descuentoCena > 0) {
          const existeCena = await this.prisma.descuentosEmpleado.findFirst({
            where: { turnoId: turno.IDturno, concepto: 'CENA' }
          });
          if (!existeCena) {
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
      include: {
        usuario: {
          select: {
            nombre: true,
            cargo: {
              select: {
                nombre: true,
                duracionDescansoMinutos: true,
                horaEntradaLunes: true, horaSalidaLunes: true,
                horaEntradaMartes: true, horaSalidaMartes: true,
                horaEntradaMiercoles: true, horaSalidaMiercoles: true,
                horaEntradaJueves: true, horaSalidaJueves: true,
                horaEntradaViernes: true, horaSalidaViernes: true,
                horaEntradaSabado: true, horaSalidaSabado: true,
                horaEntradaDomingo: true, horaSalidaDomingo: true,
              }
            }
          }
        }
      },
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
        orderBy: { fecha: 'desc' },
        include: { usuario: { select: { IDusuarios: true, nombre: true } } },
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
  // LOTE (grupo de repartos)
  // ─────────────────────────────────────────────

  async getLote(loteId: string) {
    const descuentos = await this.prisma.descuentosEmpleado.findMany({
      where: { loteId },
      include: { usuario: { select: { IDusuarios: true, nombre: true } } },
      orderBy: { fecha: 'asc' },
    });
    if (descuentos.length === 0) throw new NotFoundException('Lote no encontrado');
    return { success: true, data: descuentos };
  }

  async deleteLote(loteId: string) {
    const result = await this.prisma.descuentosEmpleado.deleteMany({ where: { loteId } });
    if (result.count === 0) throw new NotFoundException('Lote no encontrado');
    return { success: true, message: `${result.count} descuentos eliminados del lote` };
  }

  async updateLote(loteId: string, dto: any, creadoPor: string) {
    const { usuarioIds, montoTotal, concepto, descripcion, fecha } = dto;

    if (!usuarioIds || usuarioIds.length === 0) {
      throw new BadRequestException('Debes seleccionar al menos un empleado');
    }

    const usuarios = await this.prisma.usuarios.findMany({
      where: { IDusuarios: { in: usuarioIds } },
    });
    if (usuarios.length !== usuarioIds.length) {
      throw new BadRequestException('Uno o más empleados seleccionados no existen');
    }

    const montoIndividual = Math.round(Number(montoTotal) / usuarioIds.length);
    const nombresTodos = usuarios.map((u: any) => u.nombre).join(', ');

    // Build new description keeping the same format
    let newDescripcion = descripcion;
    // Strip old "repartido entre" and rebuild
    const baseDesc = descripcion.replace(/\s*repartido entre:.*\)$/, ')').replace(/\)$/, '').trim();
    newDescripcion = `${baseDesc} repartido entre: ${nombresTodos})`;

    await this.prisma.$transaction([
      // Delete old records
      this.prisma.descuentosEmpleado.deleteMany({ where: { loteId } }),
      // Create new records with the same loteId
      ...usuarioIds.map((uid: string) =>
        this.prisma.descuentosEmpleado.create({
          data: {
            usuarioId: uid,
            loteId,
            concepto: concepto || 'DESCUADRE_CAJA',
            descripcion: newDescripcion,
            valor: montoIndividual,
            estado: 'PENDIENTE',
            creadoPor,
            fecha: fecha ? new Date(fecha) : new Date(),
          },
        })
      ),
    ]);

    const updated = await this.getLote(loteId);
    return updated;
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

    const [todosLosTurnosCompletados, descuentos] = await Promise.all([
      this.prisma.turnos.findMany({
        where: {
          usuarioId,
          estado: { in: ['COMPLETADO', 'FINALIZADO'] },
        },
        orderBy: { fecha: 'desc' },
      }),
      this.prisma.descuentosEmpleado.findMany({
        where: {
          usuarioId,
          estado: { not: 'COBRADO' },
        },
        orderBy: { fecha: 'desc' },
      }),
    ]);

    const turnosAnteriores = [];
    const turnos = [];
    
    for (const t of todosLosTurnosCompletados) {
      if (fechaDesde && new Date(t.fecha) < new Date(fechaDesde)) {
        turnosAnteriores.push(t);
      } else if (!fechaHasta || new Date(t.fecha) <= new Date(fechaHasta)) {
        turnos.push(t);
      }
    }

    const totalBruto = turnos.reduce((sum: number, t: any) => sum + Number(t.valorTurno), 0);
    const CONCEPTOS_BONO = ['BONO', 'PREMIO', 'HORAS_EXTRAS'];
    const totalDescuentos = descuentos.reduce((sum: number, d: any) => {
      if (d.concepto === 'LLEGADA_TARDE' && d.estado === 'PENDIENTE') return sum;
      if (CONCEPTOS_BONO.includes(d.concepto)) return sum; // bonos no restan
      return sum + Number(d.valor);
    }, 0);
    const totalBonos = descuentos.reduce((sum: number, d: any) => {
      if (CONCEPTOS_BONO.includes(d.concepto)) return sum + Number(d.valor);
      return sum;
    }, 0);
    const totalNeto = totalBruto - totalDescuentos + totalBonos;

    const confNegocio = await this.prisma.configuracionNegocio.findFirst();
    const minutosGracia = confNegocio?.minutosGraciaLlegadaTarde ?? 5;

    return {
      success: true,
      data: {
        usuario,
        minutosGracia,
        totalTurnos: turnos.length,
        totalBruto,
        totalDescuentos,
        totalBonos,
        totalNeto,
        turnos,
        turnosAnteriores,
        descuentos,
      },
    };
  }

  // ─────────────────────────────────────────────
  // LIQUIDACIONES
  // ─────────────────────────────────────────────

  async liquidarEmpleado(dto: any, creadoPor: string) {
    const usuario = await this.prisma.usuarios.findUnique({ where: { IDusuarios: dto.usuarioId } });
    if (!usuario) throw new NotFoundException('Empleado no encontrado');

    const fechaInicio = new Date(dto.fechaInicio);
    const fechaFin = new Date(dto.fechaFin);
    fechaFin.setHours(23, 59, 59, 999);

    // Obtener turnos completados en el período y los extra seleccionados
    const extraTurnosIds = Array.isArray(dto.extraTurnosIds) ? dto.extraTurnosIds : [];
    
    const turnos = await this.prisma.turnos.findMany({
      where: {
        usuarioId: dto.usuarioId,
        OR: [
          {
            estado: { in: ['COMPLETADO', 'FINALIZADO'] },
            fecha: { gte: fechaInicio, lte: fechaFin },
          },
          {
            IDturno: { in: extraTurnosIds }
          }
        ]
      },
    });

    // Obtener todos los descuentos pendientes (no cobrados) sin importar la fecha
    const descuentos = await this.prisma.descuentosEmpleado.findMany({
      where: {
        usuarioId: dto.usuarioId,
        estado: { not: 'COBRADO' },
      },
      orderBy: { fecha: 'desc' }
    });

    const descuentosAplicados = descuentos.filter(d => !(d.concepto === 'LLEGADA_TARDE' && d.estado === 'PENDIENTE'));

    const descuentosReales = descuentosAplicados.filter(d => !['BONO', 'PREMIO', 'HORAS_EXTRAS'].includes(d.concepto));
    const bonosAplicados = descuentosAplicados.filter(d => ['BONO', 'PREMIO', 'HORAS_EXTRAS'].includes(d.concepto));

    const totalBonificaciones = bonosAplicados.reduce((sum: number, d: any) => sum + Number(d.valor), 0);
    const totalDeducciones = descuentosReales.reduce((sum: number, d: any) => sum + Number(d.valor), 0);

    const totalBruto = turnos.reduce((sum: number, t: any) => sum + Number(t.valorTurno), 0) + totalBonificaciones;
    const totalDescuentos = totalDeducciones;
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
        estado: 'ESPERANDO_FIRMA',
        observaciones: dto.observaciones || null,
        creadoPor,
        turnosDetalle: turnos as any,
        descuentosDetalle: descuentosAplicados as any,
        firmaAdmin: dto.firmaAdmin || null,
      },
      include: { usuario: { select: { nombre: true, cargo: true } } },
    });

    // Marcar turnos como LIQUIDADO
    if (turnos.length > 0) {
      await this.prisma.turnos.updateMany({
        where: { IDturno: { in: turnos.map((t: any) => t.IDturno) } },
        data: { estado: 'LIQUIDADO' },
      });
    }

    // Marcar descuentos como COBRADO
    if (descuentosAplicados.length > 0) {
      await this.prisma.descuentosEmpleado.updateMany({
        where: { IDdescuento: { in: descuentosAplicados.map((d: any) => d.IDdescuento) } },
        data: { estado: 'COBRADO' },
      });
    }

    // Emit websocket event to the specific user's room
    this.appGateway.server.to(`user_${dto.usuarioId}`).emit('nueva_liquidacion', {
      liquidacionId: liquidacion.IDliquidacion,
      mensaje: 'Tienes una nueva liquidación pendiente de firma',
    });

    return {
      success: true,
      data: liquidacion,
      mensaje: `Liquidación generada: $${totalNeto.toLocaleString('es-CO')} a pagar a ${usuario.nombre}`,
    };
  }

  async reenviarNotificacionFirma(id: string) {
    const liquidacion = await this.prisma.liquidaciones.findUnique({ where: { IDliquidacion: id } });
    if (!liquidacion) throw new NotFoundException('Liquidación no encontrada');
    
    if (liquidacion.estado !== 'ESPERANDO_FIRMA') {
      throw new BadRequestException('Esta liquidación no está esperando firma.');
    }

    // Emitir el evento de websocket al empleado
    this.appGateway.server.to(`user_${liquidacion.usuarioId}`).emit('nueva_liquidacion', {
      liquidacionId: liquidacion.IDliquidacion,
      mensaje: 'Tienes una nueva liquidación pendiente de firma',
    });

    return { success: true, message: 'Notificación enviada' };
  }

  async deshacerLiquidacion(id: string) {
    const liquidacion = await this.prisma.liquidaciones.findUnique({
      where: { IDliquidacion: id }
    });
    if (!liquidacion) throw new NotFoundException('Liquidación no encontrada');

    const turnosDetalle: any = liquidacion.turnosDetalle || [];
    const descuentosDetalle: any = liquidacion.descuentosDetalle || [];

    const turnoIds = turnosDetalle.map((t: any) => t.IDturno);
    const descuentoIds = descuentosDetalle.map((d: any) => d.IDdescuento);

    if (turnoIds.length > 0) {
      await this.prisma.turnos.updateMany({
        where: { IDturno: { in: turnoIds } },
        data: { estado: 'COMPLETADO' }
      });
    }

    if (descuentoIds.length > 0) {
      await this.prisma.descuentosEmpleado.updateMany({
        where: { IDdescuento: { in: descuentoIds } },
        data: { estado: 'APROBADO' }
      });
    }

    await this.prisma.liquidaciones.delete({
      where: { IDliquidacion: id }
    });

    return { success: true, mensaje: 'Liquidación eliminada y turnos restaurados correctamente.' };
  }

  async firmarLiquidacionEmpleado(id: string, firma: string) {
    const liquidacion = await this.prisma.liquidaciones.findUnique({ where: { IDliquidacion: id } });
    if (!liquidacion) throw new NotFoundException('Liquidación no encontrada');

    if (liquidacion.estado === 'FIRMADO') {
      throw new BadRequestException('Esta liquidación ya ha sido firmada por el empleado');
    }

    const updated = await this.prisma.liquidaciones.update({
      where: { IDliquidacion: id },
      data: {
        firmaEmpleado: firma,
        estado: 'FIRMADO',
      },
    });

    return {
      success: true,
      data: updated,
      mensaje: 'Liquidación firmada exitosamente',
    };
  }

  async firmarLiquidacionAdmin(id: string, firma: string) {
    const liquidacion = await this.prisma.liquidaciones.findUnique({ where: { IDliquidacion: id } });
    if (!liquidacion) throw new NotFoundException('Liquidación no encontrada');

    const updated = await this.prisma.liquidaciones.update({
      where: { IDliquidacion: id },
      data: {
        firmaAdmin: firma,
      },
    });

    return {
      success: true,
      data: updated,
      mensaje: 'Firma de administrador guardada exitosamente',
    };
  }

  async agregarDescuentoExtraLiquidacion(id: string, dto: { concepto: string, descripcion: string, valor: number }, adminId: string) {
    const liquidacion = await this.prisma.liquidaciones.findUnique({ where: { IDliquidacion: id } });
    if (!liquidacion) throw new NotFoundException('Liquidación no encontrada');
    if (liquidacion.estado !== 'ESPERANDO_FIRMA') throw new BadRequestException('Solo se pueden modificar liquidaciones en espera de firma');

    const descuento = await this.prisma.descuentosEmpleado.create({
      data: {
        usuarioId: liquidacion.usuarioId,
        concepto: dto.concepto,
        descripcion: dto.descripcion,
        valor: dto.valor,
        fecha: new Date(),
        estado: 'COBRADO',
        creadoPor: adminId,
      }
    });

    const currentDescuentos = (liquidacion.descuentosDetalle as any[]) || [];
    const updatedDescuentos = [descuento, ...currentDescuentos].sort((a,b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime());

    const additionalDeduction = Number(dto.valor);
    const newTotalDescuentos = Number(liquidacion.totalDescuentos) + additionalDeduction;
    const newTotalNeto = Number(liquidacion.totalBruto) - newTotalDescuentos;

    const updated = await this.prisma.liquidaciones.update({
      where: { IDliquidacion: id },
      data: {
        descuentosDetalle: updatedDescuentos,
        totalDescuentos: newTotalDescuentos,
        totalNeto: newTotalNeto,
      },
      include: { usuario: { select: { nombre: true, cargo: true } } }
    });

    return {
      success: true,
      data: updated,
      mensaje: 'Descuento extra agregado correctamente',
    };
  }

  async getLiquidaciones(usuarioId?: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const where: Prisma.LiquidacionesWhereInput = usuarioId ? { usuarioId } : {};

    const [data, total] = await Promise.all([
      this.prisma.liquidaciones.findMany({
        where, skip, take: limit,
        orderBy: { createdAt: 'desc' },
        include: { usuario: { select: { nombre: true, cargo: true } } },
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

    // Buscar turnos NO liquidados de este empleado
    const turnosPendientes = await this.prisma.turnos.findMany({
      where: {
        usuarioId,
        estado: { not: 'LIQUIDADO' },
      }
    });

    if (turnosPendientes.length === 0) {
      return { success: true, mensaje: 'No se encontraron turnos pendientes por recalcular para este empleado.' };
    }

    const confNegocio = await this.prisma.configuracionNegocio.findFirst();
    const TOLERANCIA_MINUTOS = (confNegocio as any)?.minutosGraciaLlegadaTarde ?? 5;

    let actualizados = 0;
    let llegadasTardeCreadasOActualizadas = 0;
    let cenasCalculadas = 0;

    for (const turno of turnosPendientes) {
      const entrada = new Date(turno.horaEntrada);
      // Ajustar a UTC-5 (hora de Colombia) para obtener el día real
      const colombiaTime = new Date(entrada.getTime() - (5 * 60 * 60 * 1000));
      const diaSemana = colombiaTime.getUTCDay();
      const campoDia = TARIFA_POR_DIA[diaSemana];
      const campoEntrada = HORA_ENTRADA_POR_DIA[diaSemana];
      const campoSalida = HORA_SALIDA_POR_DIA[diaSemana];

      const y = colombiaTime.getUTCFullYear();
      const m = colombiaTime.getUTCMonth();
      const d = colombiaTime.getUTCDate();
      const fechaTurno = new Date(Date.UTC(y, m, d, 0, 0, 0, 0));

      let nuevoValor = 0;
      let horaEntradaStr: string | null = null;
      let horaSalidaStr: string | null = null;
      let isExcepcion = false;

      if (usuario.cargo) {
        const excepcion = await this.prisma.excepcionHorarioCargo.findFirst({
          where: {
            cargoId: usuario.cargo.IDcargo,
            fecha: fechaTurno,
          }
        });
        if (excepcion) {
          isExcepcion = true;
          nuevoValor = Number(excepcion.tarifa);
          horaEntradaStr = excepcion.horaEntrada;
          horaSalidaStr = excepcion.horaSalida;
        }
      }

      if (!isExcepcion) {
        if (usuario.cargo) {
          nuevoValor = Number(usuario.cargo[campoDia] ?? 0);
          horaEntradaStr = (usuario.cargo[campoEntrada] as string) || null;
          horaSalidaStr = (usuario.cargo[campoSalida] as string) || null;
        }
      }

      if (usuario.tarifaPersonalizada) {
        nuevoValor = Number(usuario.tarifaPersonalizada);
      }

      // Actualizar valor de turno si es distinto o 0
      if (nuevoValor > 0 && Number(turno.valorTurno) !== nuevoValor) {
        await this.prisma.turnos.update({
          where: { IDturno: turno.IDturno },
          data: { valorTurno: nuevoValor },
        });
        actualizados++;
      } else {
        nuevoValor = Number(turno.valorTurno);
      }

      // Recalcular llegada tarde
      let minutosRetraso = 0;
      let valorDescuento = 0;
      let descLlegadaTarde = '';

      if (horaEntradaStr && horaSalidaStr && nuevoValor > 0) {

        const parseTimeStr = (t: string) => {
          const match = t.trim().match(/^(\d{1,2}):(\d{2})(?:\s*(AM|PM|am|pm))?$/);
          if (!match) return { h: 0, m: 0 };
          let h = parseInt(match[1], 10);
          const m = parseInt(match[2], 10);
          const p = match[3] ? match[3].toUpperCase() : null;
          if (p === 'PM' && h < 12) h += 12;
          if (p === 'AM' && h === 12) h = 0;
          return { h, m };
        };

        const { h: hEntrada, m: mEntrada } = parseTimeStr(horaEntradaStr);
        const { h: hSalida, m: mSalida } = parseTimeStr(horaSalidaStr);

        const minutosEsperados = (hSalida * 60 + mSalida) - (hEntrada * 60 + mEntrada);
        const minutosTotalesEsperados = minutosEsperados < 0 ? minutosEsperados + (24 * 60) : minutosEsperados;

        if (minutosTotalesEsperados > 0) {
          const valorPorMinuto = nuevoValor / minutosTotalesEsperados;
          const hActual = colombiaTime.getUTCHours();
          const mActual = colombiaTime.getUTCMinutes();
          const minutosActuales = hActual * 60 + mActual;
          const minutosEntradaEsperada = hEntrada * 60 + mEntrada;
          
          let retraso = minutosActuales - minutosEntradaEsperada;
          if (retraso > 0 && retraso < 12 * 60) {
             minutosRetraso = retraso;
          }

          if (minutosRetraso > TOLERANCIA_MINUTOS) {
             const minutosParaCobrar = minutosRetraso - TOLERANCIA_MINUTOS;
             valorDescuento = Math.round(minutosParaCobrar * valorPorMinuto);

             const formatTime = (h: number, m: number) => {
               const ampm = h >= 12 ? 'PM' : 'AM';
               let h12 = h % 12;
               if (h12 === 0) h12 = 12;
               return `${h12.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')} ${ampm}`;
             };
             const strEsperada = formatTime(hEntrada, mEntrada);
             const strLlegada = formatTime(hActual, mActual);
             const tarifaMin = valorPorMinuto.toLocaleString('es-CO', { maximumFractionDigits: 1 });
             const tarifaHora = Math.round(valorPorMinuto * 60).toLocaleString('es-CO');

             descLlegadaTarde = `Llegada: ${strLlegada} (Horario: ${strEsperada}). Retraso total: ${minutosRetraso} min. Gracia: -${TOLERANCIA_MINUTOS} min. Penalizados: ${minutosParaCobrar} min a $${tarifaMin}/min ($${tarifaHora}/h).`;
          }
        }
      }

      if (valorDescuento > 0) {
        const existeLlegada = await this.prisma.descuentosEmpleado.findFirst({
          where: { turnoId: turno.IDturno, concepto: 'LLEGADA_TARDE' }
        });

        if (!existeLlegada) {
          const fechaStr = turno.fecha.toLocaleDateString('es-CO', { timeZone: 'UTC', day: '2-digit', month: '2-digit', year: 'numeric' });
          await this.prisma.descuentosEmpleado.create({
            data: {
              usuarioId: turno.usuarioId,
              turnoId: turno.IDturno,
              concepto: 'LLEGADA_TARDE',
              descripcion: descLlegadaTarde || `Llegada tardía de ${minutosRetraso} minutos en el turno del ${fechaStr}`,
              valor: valorDescuento,
              estado: 'PENDIENTE',
              creadoPor: 'Sistema (automático)',
              fecha: turno.fecha,
            },
          });
          llegadasTardeCreadasOActualizadas++;
        } else {
          // If it exists, let's just make sure the description and value are up to date
          await this.prisma.descuentosEmpleado.update({
            where: { IDdescuento: existeLlegada.IDdescuento },
            data: {
              descripcion: descLlegadaTarde || existeLlegada.descripcion,
              valor: valorDescuento
            }
          });
          llegadasTardeCreadasOActualizadas++;
        }
      }

      // ─────────────────────────────────────────────
      // RECALCULAR CENA
      // ─────────────────────────────────────────────
      if (turno.ceno) {
        const descuentoCena = Number(usuario.cargo?.descuentoCena || 0);
        if (descuentoCena > 0) {
          const existeCena = await this.prisma.descuentosEmpleado.findFirst({
            where: { turnoId: turno.IDturno, concepto: 'CENA' }
          });
          if (!existeCena) {
            const fechaStr = turno.fecha.toLocaleDateString('es-CO', { timeZone: 'UTC', day: '2-digit', month: '2-digit', year: 'numeric' });
            await this.prisma.descuentosEmpleado.create({
              data: {
                usuarioId: turno.usuarioId,
                turnoId: turno.IDturno,
                concepto: 'CENA',
                descripcion: `Cena del turno del ${fechaStr}`,
                valor: descuentoCena,
                estado: 'APROBADO', // Las cenas suelen estar aprobadas por defecto
                creadoPor: 'Sistema (recalcular)',
                fecha: turno.fecha,
              },
            });
            cenasCalculadas++;
          } else if (Number(existeCena.valor) !== descuentoCena) {
             await this.prisma.descuentosEmpleado.update({
               where: { IDdescuento: existeCena.IDdescuento },
               data: { valor: descuentoCena }
             });
             cenasCalculadas++;
          }
        }
      } else {
        // Si el turno indica que NO cenó, limpiamos posibles descuentos de CENA residuales
        const deleted = await this.prisma.descuentosEmpleado.deleteMany({
          where: { turnoId: turno.IDturno, concepto: 'CENA' }
        });
        if (deleted.count > 0) cenasCalculadas++;
      }
    }

    return { 
      success: true, 
      mensaje: `Se recalcularon ${actualizados} valores de turno, ${llegadasTardeCreadasOActualizadas} llegadas tarde y ${cenasCalculadas} cenas.` 
    };
  }
}
