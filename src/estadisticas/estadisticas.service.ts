import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CajaService } from '../caja/caja.service';
import { startOfDay, endOfDay, addHours } from 'date-fns';

@Injectable()
export class EstadisticasService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => CajaService)) private readonly cajaService: CajaService
  ) {}

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
      fecha: { gte: start, lte: end },
      estado: { in: ['PAGADO', 'ENTREGADO'] },
      deletedAt: null
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
        valorDeTransferencia: true,
        efectivoRecibido: true,
        medioDePago: true,
      }
    });

    const ventasTotal = ventasRaw.reduce((sum, v) => sum + Number(v.totalInput || 0), 0);
    const totalTransferencias = ventasRaw.reduce((sum, v) => {
      const medio = (v.medioDePago || '').toUpperCase().replace(/_/g, ' ').trim();
      
      if (['TRANSFERENCIA', 'TRASNFERENCIA', 'NEQUI', 'DAVIPLATA', 'BANCOLOMBIA', 'TARJETA'].includes(medio)) {
        return sum + Number(v.totalInput || 0);
      } else if (medio === 'MIXTO' || medio === 'EFECTIVO Y OTROS') {
        const efectivoR = Number(v.efectivoRecibido || 0);
        const total = Number(v.totalInput || 0);
        const tr = total - efectivoR;
        return sum + tr;
      }
      return sum;
    }, 0);

    // 2. Obtener Gastos
    // NOTA: El campo `fechaYHora` es nullable. Muchos registros usan solo el campo `fecha` (@db.Date).
    // Se usa OR para cubrir ambos campos y no perder registros con fechaYHora=null.
    const gastosRaw = await this.prisma.gastos.findMany({
      where: {
        OR: [
          { fechaYHora: { gte: start, lte: end } },
          {
            fechaYHora: null,
            fecha: { gte: start, lte: end }
          },
          {
            fechaYHora: null,
            fecha: null,
            createdAt: { gte: start, lte: end }
          }
        ]
      },
      select: { valor: true, tipo: true }
    });

    let gastosNegocio = 0;
    let gastosPersonales = 0;
    gastosRaw.forEach(g => {
      if (g.tipo === 'PERSONAL') gastosPersonales += Number(g.valor || 0);
      else gastosNegocio += Number(g.valor || 0);
    });

    const utilidadNegocio = ventasTotal - gastosNegocio;
    // ⚠️ Utilidad Neta = Ventas - Gastos Negocio - Gastos Personales - Inventario
    // (el inventario representa el costo de lo que se compró/repuso en el periodo)

    // 3. Obtener Total Inventario (compras en el periodo)
    // También usamos OR por si fechaYHora es null en algunos registros
    const inventarioRaw = await this.prisma.inventario.findMany({
      where: {
        OR: [
          {
            fechaYHora: { gte: start, lte: end },
            tipo: { contains: 'ENTRADA', mode: 'insensitive' }
          },
          {
            fechaYHora: null,
            createdAt: { gte: start, lte: end },
            tipo: { contains: 'ENTRADA', mode: 'insensitive' }
          }
        ]
      },
      select: { total: true, descuento: true }
    });
    const inventarioTotal = inventarioRaw.reduce((sum, i) => sum + (Number(i.total || 0) - Number(i.descuento || 0)), 0);

    // Utilidad Neta definitiva: descontar también el inventario
    const utilidadNeta = utilidadNegocio - gastosPersonales - inventarioTotal;

    // 3b. Apertura y Cierre de Caja: plata guardada y transferencias contadas
    const cajasRaw = await this.prisma.aperturaCierreCaja.findMany({
      where: {
        fechaDeApertura: { gte: start, lte: end }
      },
      select: {
        plataGuardada: true,
        transferenciasContadas: true,
        fechaDeCierre: true,
        fechaDeApertura: true,
      }
    });
    const totalPlataGuardada = cajasRaw.reduce((sum, c) => sum + Number(c.plataGuardada || 0), 0);
    const totalTransferenciasContadas = cajasRaw.reduce((sum, c) => sum + Number(c.transferenciasContadas || 0), 0);

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
      totales: { ventas: ventasTotal, gastosNegocio, gastosPersonales, utilidadNegocio, utilidadNeta, inventarioTotal, totalTransferencias, totalPlataGuardada, totalTransferenciasContadas },
      graficos: {
        diario: sortAndMap(ventasPorDiaMap),
        semanal: sortAndMap(ventasPorSemanaMap),
        mensual: sortAndMap(ventasPorMesMap)
      },
      productos
    };
  }

  async getInsumosDescuadres(startDate: string, endDate: string) {
    let start = new Date(startDate);
    start.setUTCHours(0, 0, 0, 0);
    
    let end = new Date(endDate);
    end.setUTCHours(23, 59, 59, 999);

    // Buscar todas las cajas en ese rango
    // Se usa fechaYHora como referencia.
    const cajas = await this.prisma.aperturaCierreCaja.findMany({
      where: {
        cierre: 'cerrada',
        fechaDeApertura: {
          gte: start,
          lte: end,
        },
      },
      select: { IDcaja: true, fechaDeApertura: true }
    });

    const insumosMap = new Map<string, any>();

    for (const caja of cajas) {
      try {
        const resumen = await this.cajaService.getResumenCaja(caja.IDcaja);
        
        if (resumen && resumen.insumos) {
          for (const ins of resumen.insumos) {
            const diff = ins.diferencia || 0;
            // Solo contabilizamos si hubo movimiento o diferencia
            if (diff !== 0 || ins.ventasEnSistema > 0 || (ins.seUtilizaron || 0) > 0) {
              const id = ins.nombreInsumo || '';
              if (!insumosMap.has(id)) {
                insumosMap.set(id, {
                  id,
                  nombre: ins.nombreReal || id,
                  totalFaltantes: 0,
                  totalSobrantes: 0,
                  frecuenciaDescuadre: 0,
                  ventasSistema: 0,
                  gastadoFisico: 0,
                  detalles: []
                });
              }
              
              const current = insumosMap.get(id);
              current.ventasSistema += ins.ventasEnSistema || 0;
              current.gastadoFisico += ins.seUtilizaron || 0;
              
              if (diff !== 0) {
                current.frecuenciaDescuadre += 1;
                // Si la diferencia es > 0, significa que se utilizó más de lo esperado en sistema = FALTANTE
                // Si la diferencia es < 0, significa que se utilizó menos de lo esperado = SOBRANTE
                current.detalles.push({
                  fecha: caja.fechaDeApertura,
                  diferencia: diff,
                  tipo: diff > 0 ? 'FALTANTE' : 'SOBRANTE',
                  ventasSistema: ins.ventasEnSistema || 0,
                  gastadoFisico: ins.seUtilizaron || 0
                });

                if (diff > 0) {
                  current.totalFaltantes += diff; 
                } else {
                  current.totalSobrantes += Math.abs(diff); 
                }
              }
            }
          }
        }
      } catch (e) {
        console.error(`Error procesando resumen de caja ${caja.IDcaja}`, e);
      }
    }

    const resultados = Array.from(insumosMap.values());
    
    // Calcular netos
    resultados.forEach(r => {
      r.diferenciaNeta = r.totalSobrantes - r.totalFaltantes; 
      r.totalDescuadresAbsoluto = r.totalFaltantes + r.totalSobrantes;
    });

    // Ordenar por defecto alfabéticamente
    resultados.sort((a, b) => a.nombre.localeCompare(b.nombre));

    // Generar el ranking (top 5 de insumos con más descuadres absolutos)
    const ranking = [...resultados]
      .filter(r => r.totalDescuadresAbsoluto > 0)
      .sort((a, b) => b.totalDescuadresAbsoluto - a.totalDescuadresAbsoluto)
      .slice(0, 5);

    return {
      success: true,
      data: resultados,
      ranking
    };
  }

  async getInsumosPreciosMulti(startDate?: string, endDate?: string, categoriaId?: string) {
    let start = new Date();
    let end = new Date();

    if (startDate) {
      start = new Date(startDate);
      start.setUTCHours(0, 0, 0, 0);
    } else {
      start.setDate(1);
      start.setUTCHours(0, 0, 0, 0);
    }

    if (endDate) {
      end = new Date(endDate);
      end.setUTCHours(23, 59, 59, 999);
    } else {
      end.setUTCHours(23, 59, 59, 999);
    }

    // 1. Obtener catálogo de insumos
    const insumosWhere: any = {};
    if (categoriaId) {
      insumosWhere.categoria = categoriaId;
    }

    const insumosCatalog = await this.prisma.insumos.findMany({
      where: insumosWhere,
      select: {
        IDalimentos: true,
        nombre: true,
        categoria: true,
        nombreCategoria: true,
        unidades: true,
        precio: true,
        disponible: true,
        createdAt: true,
        categoriaInsumosRelacion: {
          select: { nombre: true },
        },
      },
      orderBy: { nombre: 'asc' },
    });

    // Mapeos rápidos por ID y por nombre para vincular compras
    const byId = new Map<string, (typeof insumosCatalog)[0]>();
    const byName = new Map<string, (typeof insumosCatalog)[0]>();

    insumosCatalog.forEach((ins) => {
      byId.set(ins.IDalimentos, ins);
      if (ins.nombre) {
        byName.set(ins.nombre.trim().toLowerCase(), ins);
      }
    });

    // 2. Obtener órdenes de inventario en el período
    const ordersRaw = await this.prisma.orderinventario.findMany({
      where: {
        OR: [
          { fechaYHora: { gte: start, lte: end } },
          {
            fechaYHora: null,
            fecha: { gte: start, lte: end },
          },
          {
            fechaYHora: null,
            fecha: null,
            createdAt: { gte: start, lte: end },
          },
        ],
        AND: [
          {
            OR: [
              { precio: { gt: 0 } },
              { precioActual: { gt: 0 } },
            ],
          },
        ],
      },
      orderBy: [
        { fechaYHora: 'asc' },
        { fecha: 'asc' },
        { createdAt: 'asc' },
      ],
      include: {
        proveedor: {
          select: { nombre: true },
        },
        inventario: {
          select: { tipo: true, nombre: true },
        },
      },
    });

    const PALETTE = [
      '#2563eb', // Azul
      '#10b981', // Verde esmeralda
      '#f59e0b', // Naranja ámbar
      '#8b5cf6', // Púrpura
      '#ef4444', // Rojo
      '#06b6d4', // Cian
      '#ec4899', // Rosa
      '#84cc16', // Lima
      '#6366f1', // Índigo
      '#14b8a6', // Teal
      '#f97316', // Naranja brillante
      '#a855f7', // Violeta
    ];

    // Estructura agrupada de compras por insumo
    const insumoPurchasesMap = new Map<
      string,
      Array<{
        date: string;
        label: string;
        value: number;
        precioAnterior?: number;
        proveedor: string;
        cantidad: number;
        subtotal: number;
      }>
    >();

    ordersRaw.forEach((order) => {
      const key = order.nombreDelAlimento?.trim() || '';
      if (!key) return;

      const matchedInsumo = byId.get(key) || byName.get(key.toLowerCase());
      const insumoId = matchedInsumo ? matchedInsumo.IDalimentos : key;

      if (!insumoPurchasesMap.has(insumoId)) {
        insumoPurchasesMap.set(insumoId, []);
      }

      const rawDate = order.fechaYHora || order.fecha || order.createdAt || new Date();
      const d = new Date(rawDate);
      const day = String(d.getDate()).padStart(2, '0');
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const year = d.getFullYear();
      const dateStr = `${year}-${month}-${day}`;
      const labelStr = `${day}/${month}`;

      const unitPrice = Number(order.precioActual || order.precio || 0);
      const prevPrice = order.precioAnterior != null ? Number(order.precioAnterior) : undefined;
      const qty = Number(order.cantidad || 0);
      const subtotal = Number(order.subtotal || unitPrice * qty);
      const supplierName = order.proveedor?.nombre || order.provedor || 'Proveedor';

      insumoPurchasesMap.get(insumoId)!.push({
        date: dateStr,
        label: labelStr,
        value: unitPrice,
        precioAnterior: prevPrice,
        proveedor: supplierName,
        cantidad: qty,
        subtotal,
      });
    });

    // 3. Consolidar el resultado para cada insumo del catálogo
    const insumosConsolidados = insumosCatalog.map((ins, index) => {
      const purchases = insumoPurchasesMap.get(ins.IDalimentos) || [];
      const color = PALETTE[index % PALETTE.length];
      const precioCatalogo = Number(ins.precio || 0);

      let precioInicial = precioCatalogo;
      let precioFinal = precioCatalogo;
      let precioPromedio = precioCatalogo;
      let precioMin = precioCatalogo;
      let precioMax = precioCatalogo;
      let totalComprado = 0;
      let subtotalComprado = 0;
      let ultimoProveedor = 'Sin compras registradas';
      let variacionPorcentual = 0;
      let variacionAbsoluta = 0;

      if (purchases.length > 0) {
        purchases.sort((a, b) => a.date.localeCompare(b.date));

        precioInicial =
          purchases[0].precioAnterior && purchases[0].precioAnterior > 0
            ? purchases[0].precioAnterior
            : purchases[0].value;

        precioFinal = purchases[purchases.length - 1].value;

        const values = purchases.map((p) => p.value);
        precioMin = Math.min(...values);
        precioMax = Math.max(...values);

        totalComprado = purchases.reduce((acc, p) => acc + p.cantidad, 0);
        subtotalComprado = purchases.reduce((acc, p) => acc + p.subtotal, 0);

        precioPromedio =
          totalComprado > 0
            ? Math.round(subtotalComprado / totalComprado)
            : Math.round(values.reduce((a, b) => a + b, 0) / values.length);

        ultimoProveedor = purchases[purchases.length - 1].proveedor;

        variacionAbsoluta = precioFinal - precioInicial;
        variacionPorcentual =
          precioInicial > 0
            ? Number(((variacionAbsoluta / precioInicial) * 100).toFixed(1))
            : 0;
      }

      return {
        id: ins.IDalimentos,
        nombre: ins.nombre,
        categoria: ins.categoriaInsumosRelacion?.nombre || ins.nombreCategoria || 'General',
        unidad: ins.unidades || 'und',
        color,
        precioActual: precioFinal > 0 ? precioFinal : precioCatalogo,
        precioInicial,
        precioPromedio,
        precioMin,
        precioMax,
        variacionPorcentual,
        variacionAbsoluta,
        totalComprado,
        subtotalComprado,
        ultimoProveedor,
        comprasRegistradas: purchases.length,
        seriePuntos: purchases,
      };
    });

    insumosConsolidados.sort((a, b) => {
      if (a.comprasRegistradas > 0 && b.comprasRegistradas === 0) return -1;
      if (b.comprasRegistradas > 0 && a.comprasRegistradas === 0) return 1;
      return Math.abs(b.variacionPorcentual) - Math.abs(a.variacionPorcentual);
    });

    const conAumento = insumosConsolidados.filter((i) => i.variacionPorcentual > 0);
    const conBaja = insumosConsolidados.filter((i) => i.variacionPorcentual < 0);
    const estables = insumosConsolidados.filter((i) => i.variacionPorcentual === 0);

    return {
      success: true,
      data: {
        resumen: {
          totalInsumosAuditados: insumosConsolidados.length,
          insumosConCompras: insumosConsolidados.filter((i) => i.comprasRegistradas > 0).length,
          insumosConAumento: conAumento.length,
          insumosConBaja: conBaja.length,
          insumosEstables: estables.length,
        },
        insumos: insumosConsolidados,
      },
    };
  }
}
