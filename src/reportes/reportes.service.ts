import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { startOfDay, endOfDay } from 'date-fns';

@Injectable()
export class ReportesService {
  constructor(private readonly prisma: PrismaService) {}

  // 1. Obtener la lista de reportes (Filters)
  async getReportesDineroGuardado() {
    const reportes = await this.prisma.filter.findMany({
      where: {
        tipoDeFiltro: 'REPORTE DE DINERO GUARDADO'
      },
      orderBy: {
        desde: 'desc'
      }
    });
    return reportes;
  }

  // 2. Crear un nuevo reporte en la tabla Filter
  async crearReporteDineroGuardado(startDate: string, endDate: string) {
    const desde = new Date(`${startDate}T00:00:00Z`);
    desde.setUTCHours(5, 0, 0, 0);
    
    const hasta = new Date(`${endDate}T00:00:00Z`);
    hasta.setUTCHours(28, 59, 59, 999);

    // Encontrar si ya existe este reporte
    const reporteExistente = await this.prisma.filter.findFirst({
      where: {
        tipoDeFiltro: 'REPORTE DE DINERO GUARDADO',
        desde: { gte: desde, lte: hasta }
      }
    });

    // Calcular la sumatoria de Plata Guardada en ese rango
    const cajas = await this.prisma.aperturaCierreCaja.findMany({
      where: {
        fechaDeApertura: { gte: desde, lte: hasta }
      },
      select: { plataGuardada: true, fechaDeApertura: true }
    });

    const totalDePlataGuardada = cajas.reduce((sum, c) => sum + Number(c.plataGuardada || 0), 0);

    let reporte = reporteExistente;

    if (!reporte) {
      reporte = await this.prisma.filter.create({
        data: {
          desde,
          hasta,
          tipoDeFiltro: 'REPORTE DE DINERO GUARDADO',
          totalDePlataGuardada: totalDePlataGuardada
        }
      });
    }

    // Verificar si el reporte tiene retiros asociados (por si falló en un intento anterior o es nuevo)
    const retirosExistentes = await this.prisma.dineroRetirado.count({
      where: { filterID: reporte.FilterID }
    });

    if (retirosExistentes === 0 && cajas.length > 0) {
      // Pre-cargar automáticamente los valores de Plata Guardada en la tabla DineroRetirado
      for (const caja of cajas) {
        const valor = Number(caja.plataGuardada || 0);
        if (valor > 0) {
          await this.prisma.dineroRetirado.create({
            data: {
              filterID: reporte.FilterID,
              valor: valor,
              retiro: 0,
              sobrante: valor,
              total: valor,
              fechaYHora: caja.fechaDeApertura || new Date(),
              observacion: ''
            }
          });
        }
      }
    }

    return reporte;
  }

  // 3. Eliminar un reporte
  async eliminarReporte(filterId: string) {
    const reporte = await this.prisma.filter.findUnique({ where: { FilterID: filterId } });
    if (!reporte) throw new NotFoundException('Reporte no encontrado');

    // Opcional: Eliminar retiros asociados a este reporte
    await this.prisma.dineroRetirado.deleteMany({
      where: { filterID: filterId }
    });

    await this.prisma.filter.delete({
      where: { FilterID: filterId }
    });

    return { message: 'Reporte eliminado' };
  }

  // 4. Obtener el detalle de un reporte, con las cajas y retiros asociados
  async getDetalleDineroGuardado(filterId: string) {
    const reporte = await this.prisma.filter.findUnique({
      where: { FilterID: filterId }
    });

    if (!reporte) throw new NotFoundException(`Reporte con ID ${filterId} no encontrado`);

    // Obtener las cajas en ese rango
    const cajas = await this.prisma.aperturaCierreCaja.findMany({
      where: {
        fechaDeApertura: {
          gte: reporte.desde || new Date(0),
          lte: reporte.hasta || new Date()
        }
      },
      select: {
        IDcaja: true,
        nombre: true,
        fechaDeApertura: true,
        plataGuardada: true,
        cuadroCaja: true,
        observaciones: true,
        resumen: true,
        valorFaltante: true,
        valorExcedente: true,
        venta: {
          select: {
            medioDePago: true,
            totalInput: true,
            efectivoRecibido: true,
            valorDeTransferencia: true
          }
        }
      },
      orderBy: { fechaDeApertura: 'asc' }
    });

    // Obtener los retiros asociados a este "FilterID"
    const retiros = await this.prisma.dineroRetirado.findMany({
      where: { filterID: filterId },
      orderBy: { fechaYHora: 'desc' }
    });

    // Recalcular totales (por si hubo nuevas cajas desde que se creó el filtro)
    const plataGuardadaInicial = cajas.reduce((sum, c) => sum + Number(c.plataGuardada || 0), 0);
    const totalRetirado = retiros.reduce((sum, r) => sum + Number(r.valor || 0), 0); // Usamos "valor" como indicó el usuario
    const sobranteActual = plataGuardadaInicial - totalRetirado;

    return {
      reporte,
      cajas,
      plataGuardadaInicial,
      totalRetirado,
      sobranteActual,
      retiros
    };
  }

  // 5. Crear un nuevo retiro (salida de dinero guardado)
  async crearRetiro(filterId: string, data: { retiroId: string; monto: number; observacion: string; usuario: string }) {
    // Encontrar el registro específico de DineroRetirado
    const registro = await this.prisma.dineroRetirado.findUnique({
      where: { IDretiro: data.retiroId }
    });

    if (!registro) throw new NotFoundException('Registro de dinero no encontrado');

    const valorOriginal = Number(registro.valor || 0);
    const retiroAcumulado = Number(registro.retiro || 0) + data.monto;
    const nuevoSobrante = valorOriginal - retiroAcumulado;

    const fechaStr = new Date().toLocaleString('es-CO', { 
      day: '2-digit', month: '2-digit', year: 'numeric', 
      hour: '2-digit', minute: '2-digit' 
    });
    
    const nuevaLineaObs = `$${data.monto} (${data.observacion}) ${fechaStr}`;
    const observacionFinal = registro.observacion 
      ? `${registro.observacion}\n${nuevaLineaObs}` 
      : nuevaLineaObs;

    const retiroActualizado = await this.prisma.dineroRetirado.update({
      where: { IDretiro: data.retiroId },
      data: {
        retiro: retiroAcumulado,
        sobrante: nuevoSobrante,
        observacion: observacionFinal
      }
    });

    return retiroActualizado;
  }

  // 6. Eliminar un retiro (Resetear el slot de ese día)
  async eliminarRetiro(retiroId: string) {
    const retiro = await this.prisma.dineroRetirado.findUnique({
      where: { IDretiro: retiroId }
    });

    if (!retiro) throw new NotFoundException('Registro no encontrado');

    await this.prisma.dineroRetirado.update({
      where: { IDretiro: retiroId },
      data: {
        retiro: 0,
        sobrante: retiro.valor,
        observacion: ''
      }
    });

    return { message: 'Registro reseteado exitosamente' };
  }

  // 7. Crear una base manual
  async crearBaseManual(filterId: string, valor: number, observacion: string) {
    const reporte = await this.prisma.filter.findUnique({ where: { FilterID: filterId } });
    if (!reporte) throw new NotFoundException('Reporte no encontrado');

    const retiro = await this.prisma.dineroRetirado.create({
      data: {
        filterID: filterId,
        valor: valor,
        retiro: 0,
        sobrante: valor,
        total: valor,
        fechaYHora: new Date(),
        observacion: observacion || 'Base ingresada manualmente'
      }
    });

    await this.prisma.filter.update({
      where: { FilterID: filterId },
      data: {
        totalDePlataGuardada: Number(reporte.totalDePlataGuardada || 0) + valor
      }
    });

    return retiro;
  }
}
