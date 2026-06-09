import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { startOfDay, endOfDay, addHours } from 'date-fns';

@Injectable()
export class EstadisticasService {
  constructor(private readonly prisma: PrismaService) {}

  async getEstadisticasGenerales(startDate?: string, endDate?: string, categoriaProducto?: string, vendedorId?: string) {
    // Las fechas enviadas por el front ("2025-12-01") deben ser tratadas como límites exactos del día en la zona horaria local
    // Al usar new Date("2025-12-01") en un entorno UTC, se parsea como 2025-12-01T00:00:00Z.
    // Como las fechas en DB (@db.Date) se guardan en UTC pero representan la fecha local del negocio,
    // simplemente parseamos los strings de fecha, los dejamos en UTC, y ajustamos sus horas a 00:00 y 23:59
    
    let start = new Date();
    let end = new Date();

    if (startDate) {
      start = new Date(startDate); // Ej: 2025-12-01T00:00:00.000Z
    } else {
      start.setDate(1);
      start.setUTCHours(0, 0, 0, 0);
    }

    if (endDate) {
      end = new Date(endDate);
      end.setUTCHours(23, 59, 59, 999); // Final del día
    } else {
      end.setUTCHours(23, 59, 59, 999);
    }

    // Construir where para Ventas
    const ventasWhere: any = {
      fecha: { gte: start, lte: end }
    };
    if (vendedorId) {
      ventasWhere.usuario = vendedorId;
    }

    // 1. Obtener Ventas Totales
    const ventasRaw = await this.prisma.ventas.findMany({
      where: ventasWhere,
      select: {
        totalInput: true,
        fecha: true,
      }
    });

    const ventasTotal = ventasRaw.reduce((sum, v) => sum + Number(v.totalInput || 0), 0);

    // 2. Obtener Gastos
    const gastosRaw = await this.prisma.gastos.findMany({
      where: { fechaYHora: { gte: start, lte: end } },
      select: { valor: true, tipo: true }
    });

    let gastosNegocio = 0;
    let gastosPersonales = 0;
    gastosRaw.forEach(g => {
      if (g.tipo === 'PERSONAL') gastosPersonales += Number(g.valor || 0);
      else gastosNegocio += Number(g.valor || 0);
    });

    const utilidadNegocio = ventasTotal - gastosNegocio;
    const utilidadNeta = utilidadNegocio - gastosPersonales;

    // 3. Obtener Total Inventario (compras en el periodo)
    const inventarioRaw = await this.prisma.orderinventario.findMany({
      where: { fechaYHora: { gte: start, lte: end } },
      select: { subtotal: true }
    });
    const inventarioTotal = inventarioRaw.reduce((sum, i) => sum + Number(i.subtotal || 0), 0);

    // 4. Datos para los gráficos de barras (Diario, Semanal, Mensual)
    const ventasPorDiaMap = new Map<string, number>();
    const ventasPorSemanaMap = new Map<string, number>();
    const ventasPorMesMap = new Map<string, number>();

    const getWeekNumber = (d: Date) => {
      const date = new Date(d.getTime());
      date.setUTCHours(0, 0, 0, 0);
      date.setUTCDate(date.getUTCDate() + 3 - (date.getUTCDay() + 6) % 7);
      const week1 = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
      return 1 + Math.round(((date.getTime() - week1.getTime()) / 86400000 - 3 + (week1.getUTCDay() + 6) % 7) / 7);
    };

    ventasRaw.forEach(v => {
      if (!v.fecha) return;
      
      // La base de datos arroja un objeto Date (en UTC).
      // Usamos getUTCFullYear, getUTCMonth, etc., para evitar que el servidor de Node le aplique un offset local (UTC-5)
      // que causaría que 2025-12-03T00:00:00.000Z pase a ser 2025-12-02.
      const d = v.fecha;
      const val = Number(v.totalInput || 0);

      const year = d.getUTCFullYear();
      const month = (d.getUTCMonth() + 1).toString().padStart(2, '0');
      const day = d.getUTCDate().toString().padStart(2, '0');

      // Diario: YYYY-MM-DD (Estricto desde UTC para no restar 1 día)
      const dateStr = `${year}-${month}-${day}`;
      ventasPorDiaMap.set(dateStr, (ventasPorDiaMap.get(dateStr) || 0) + val);

      // Semanal (ej: "2026-W01")
      const weekStr = `${year}-W${getWeekNumber(d).toString().padStart(2, '0')}`;
      ventasPorSemanaMap.set(weekStr, (ventasPorSemanaMap.get(weekStr) || 0) + val);

      // Mensual (ej: "2026-01")
      const monthStr = `${year}-${month}`;
      ventasPorMesMap.set(monthStr, (ventasPorMesMap.get(monthStr) || 0) + val);
    });

    const sortAndMap = (map: Map<string, number>) => Array.from(map.entries())
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => a.label.localeCompare(b.label));

    // 5. Desglose de Productos
    const prodWhere: any = {
      venta: ventasWhere
    };
    if (categoriaProducto) {
      prodWhere.categoriaProducto = categoriaProducto; // Asumiendo que existe o filtramos
    }

    const productosVendidosRaw = await this.prisma.orderventas.findMany({
      where: prodWhere,
      select: {
        nombreProducto: true,
        cantidad: true,
        precioTotal: true,
        categoriaProducto: true
      }
    });

    const productosMap = new Map<string, { cantidad: number; total: number; categoria: string }>();
    
    productosVendidosRaw.forEach(p => {
      // Aplicar filtro de categoría manual si no coincide en DB por mayúsculas/minúsculas
      if (categoriaProducto && p.categoriaProducto !== categoriaProducto) return;

      const nombre = p.nombreProducto || 'Desconocido';
      const current = productosMap.get(nombre) || { cantidad: 0, total: 0, categoria: p.categoriaProducto || '' };
      
      productosMap.set(nombre, {
        cantidad: current.cantidad + Number(p.cantidad || 0),
        total: current.total + Number(p.precioTotal || 0),
        categoria: p.categoriaProducto || current.categoria
      });
    });

    const productos = Array.from(productosMap.entries())
      .map(([nombre, datos]) => ({
        nombre,
        cantidad: datos.cantidad,
        total: datos.total,
        categoria: datos.categoria
      }))
      .sort((a, b) => b.total - a.total);

    return {
      totales: { ventas: ventasTotal, gastosNegocio, gastosPersonales, utilidadNegocio, utilidadNeta, inventarioTotal },
      graficos: {
        diario: sortAndMap(ventasPorDiaMap),
        semanal: sortAndMap(ventasPorSemanaMap),
        mensual: sortAndMap(ventasPorMesMap)
      },
      productos
    };
  }
}
