/**
 * SCRIPT DE AUDITORÍA DE CAJA
 * Replica exactamente la lógica de getResumenCaja() del backend
 * para contrastar los valores que muestra la app con la BD real.
 *
 * Uso:
 *   node scripts/audit_caja.js [FECHA]
 *   node scripts/audit_caja.js 2026-06-01
 *   node scripts/audit_caja.js          <- usa HOY
 */

require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient({ log: [] });

// ─── helpers ──────────────────────────────────────────────────────────────────
const COP = (n) => `$${Number(n).toLocaleString('es-CO')}`;
const pct = (part, total) => total === 0 ? '0%' : `${((part / total) * 100).toFixed(1)}%`;
const hr = (char = '─', len = 70) => char.repeat(len);

// ─── args ──────────────────────────────────────────────────────────────────────
const fechaArg = process.argv[2]; // ej: 2026-06-01

async function main() {
  console.log('\n' + hr('═') + '\n  🔍  AUDITORÍA DE CAJA — Q\'Hubo Mor POS\n' + hr('═'));

  // ── 1. Encontrar la caja del día ───────────────────────────────────────────
  let cajaWhere = {};
  if (fechaArg) {
    const d = new Date(fechaArg + 'T12:00:00Z');
    const dStart = new Date(fechaArg + 'T00:00:00Z');
    const dEnd   = new Date(fechaArg + 'T23:59:59Z');
    cajaWhere = { fechaDeApertura: { gte: dStart, lte: dEnd } };
  } else {
    // última caja abierta
    cajaWhere = {};
  }

  const cajas = await prisma.aperturaCierreCaja.findMany({
    where: cajaWhere,
    orderBy: { fechaDeApertura: 'desc' },
    take: 5,
  });

  if (cajas.length === 0) {
    console.error('❌ No se encontró ninguna caja para la fecha indicada.');
    process.exit(1);
  }

  // Tomar la más reciente (o la última abierta)
  const caja = cajas[0];

  console.log(`\n📦  CAJA ANALIZADA`);
  console.log(`    ID          : ${caja.IDcaja}`);
  console.log(`    Nombre      : ${caja.nombre || 'N/A'}`);
  console.log(`    Apertura    : ${caja.fechaDeApertura?.toISOString().slice(0, 10)}`);
  console.log(`    Cierre      : ${caja.fechaDeCierre?.toISOString().slice(0, 10) || 'ABIERTA'}`);
  console.log(`    Estado      : ${caja.cierre || 'N/A'}`);
  console.log(`    EfectivoAp  : ${COP(caja.efectivoDeApertura || 0)}`);
  console.log(`    EfectivoCi  : ${COP(caja.efectivoDeCierre || 0)}`);
  console.log(`    Cuadro Caja : ${caja.cuadroCaja || 'N/A'}`);
  console.log(`    Val.Faltante: ${COP(caja.valorFaltante || 0)}`);
  console.log(`    Val.Excedente: ${COP(caja.valorExcedente || 0)}`);
  console.log(`    Trans.Cont. : ${COP(caja.transferenciasContadas || 0)}`);

  // ── 2. Calcular rango de fechas (igual que el servicio) ────────────────────
  let fechaInicio = new Date(caja.fechaDeApertura);
  fechaInicio.setUTCHours(5, 0, 0, 0); // medianoche Colombia = 05:00 UTC

  let fechaFin = new Date();
  if (caja.fechaDeCierre) {
    fechaFin = new Date(caja.fechaDeCierre);
    fechaFin.setUTCHours(28, 59, 59, 999);
  }

  console.log(`\n📅  RANGO DE VENTAS CONSULTADO`);
  console.log(`    Desde : ${fechaInicio.toISOString()}`);
  console.log(`    Hasta : ${fechaFin.toISOString()}`);

  // ── 3. Traer ventas (mismos filtros que el backend) ─────────────────────────
  const allVentas = await prisma.ventas.findMany({
    where: {
      estado: { in: ['PAGADO', 'ENTREGADO'] },
      deletedAt: null,
      fechaYHora: { gte: fechaInicio, lte: fechaFin },
    },
    include: { ordenVentas: true },
    orderBy: { fechaYHora: 'asc' },
  });

  // También traer todas las ventas del día SIN filtro de estado para detectar fantasmas
  const todasVentasDia = await prisma.ventas.findMany({
    where: {
      deletedAt: null,
      fechaYHora: { gte: fechaInicio, lte: fechaFin },
    },
    orderBy: { fechaYHora: 'asc' },
  });

  // Ventas eliminadas (soft delete)
  const ventasEliminadas = await prisma.ventas.findMany({
    where: {
      deletedAt: { not: null },
      fechaYHora: { gte: fechaInicio, lte: fechaFin },
    },
    orderBy: { fechaYHora: 'asc' },
  });

  console.log(`\n📊  INVENTARIO DE VENTAS DEL DÍA`);
  console.log(`    Total registros en BD (sin filtro): ${todasVentasDia.length}`);
  console.log(`    ├─ PAGADO/ENTREGADO (cuentan)     : ${allVentas.length}`);
  console.log(`    ├─ Soft-deleted (eliminadas)       : ${ventasEliminadas.length}`);
  
  // Agrupar el resto por estado
  const estadoMap = {};
  todasVentasDia.forEach(v => {
    estadoMap[v.estado || 'null'] = (estadoMap[v.estado || 'null'] || 0) + 1;
  });
  Object.entries(estadoMap).sort().forEach(([k, v]) => {
    const marcador = ['PAGADO','ENTREGADO'].includes(k) ? '✅' : '⚠️ ';
    console.log(`    ${marcador} ${k.padEnd(25)} : ${v} venta(s)`);
  });

  // ── 4. Calcular totales por método de pago ─────────────────────────────────
  let totalEfectivo = 0, totalTransferencia = 0, totalNequi = 0, totalTarjeta = 0;
  let cantEf = 0, cantTr = 0, cantNq = 0, cantTj = 0;
  const ventasConMedioDesconocido = [];

  for (const v of allVentas) {
    const medioRaw = (v.medioDePago || '').toUpperCase().replace(/_/g, ' ').trim();
    const totalV = Number(v.totalInput || 0);

    if (medioRaw === 'EFECTIVO') {
      totalEfectivo += totalV; cantEf++;
    } else if (medioRaw === 'NEQUI') {
      totalNequi += totalV; cantNq++;
    } else if (['TRANSFERENCIA','TRASNFERENCIA','DAVIPLATA'].includes(medioRaw)) {
      totalTransferencia += totalV; cantTr++;
    } else if (medioRaw === 'TARJETA') {
      totalTarjeta += totalV; cantTj++;
    } else if (['MIXTO','EFECTIVO Y OTROS'].includes(medioRaw)) {
      const ef = Number(v.efectivoRecibido || 0);
      const tr = totalV - ef;
      const bancoRaw = (v.banco || '').toUpperCase().trim();
      if (bancoRaw === 'NEQUI') { totalNequi += tr; } else { totalTransferencia += tr; }
      totalEfectivo += ef;
      cantEf++; cantTr++;
    } else {
      ventasConMedioDesconocido.push({ pedido: v.pedido, medio: medioRaw, total: totalV });
    }
  }

  const totalTransferenciasApp = totalTransferencia + totalNequi;
  const efectivoApertura = Number(caja.efectivoDeApertura || 0);
  const totalEfectivoEsperado = efectivoApertura + totalEfectivo;

  console.log(`\n💰  TOTALES POR MÉTODO DE PAGO (ventas PAGADO/ENTREGADO)`);
  console.log(hr());
  console.log(`  EFECTIVO`);
  console.log(`    Ventas efectivo              : ${cantEf} pedidos → ${COP(totalEfectivo)}`);
  console.log(`    + Efectivo de apertura       : ${COP(efectivoApertura)}`);
  console.log(`    = TOTAL ESPERADO CAJA        : ${COP(totalEfectivoEsperado)}`);
  console.log(`    Físico contado (app)         : ${COP(caja.efectivoDeCierre || 0)}`);
  const diffEf = Number(caja.efectivoDeCierre || 0) - totalEfectivoEsperado;
  console.log(`    Diferencia                   : ${COP(diffEf)} ${diffEf < 0 ? '❌ FALTAN' : diffEf > 0 ? '⚠️  SOBRAN' : '✅ CUADRA'}`);

  console.log(`\n  TRANSFERENCIAS / NEQUI`);
  console.log(`    Ventas Nequi                 : ${cantNq} pedidos → ${COP(totalNequi)}`);
  console.log(`    Ventas Transferencia/Daviplata: ${cantTr} pedidos → ${COP(totalTransferencia)}`);
  console.log(`    = TOTAL ESPERADO TRANSF.     : ${COP(totalTransferenciasApp)}`);
  console.log(`    Físico contado (app)         : ${COP(caja.transferenciasContadas || 0)}`);
  const diffTr = Number(caja.transferenciasContadas || 0) - totalTransferenciasApp;
  console.log(`    Diferencia                   : ${COP(diffTr)} ${diffTr < 0 ? '❌ FALTAN' : diffTr > 0 ? '⚠️  SOBRAN' : '✅ CUADRA'}`);

  if (totalTarjeta > 0) {
    console.log(`\n  TARJETA: ${cantTj} pedidos → ${COP(totalTarjeta)}`);
  }

  const grandTotal = totalEfectivo + totalNequi + totalTransferencia + totalTarjeta;
  console.log(`\n  GRAN TOTAL VENTAS             : ${COP(grandTotal)}`);
  console.log(`  Venta promedio                : ${COP(allVentas.length > 0 ? grandTotal / allVentas.length : 0)}`);

  if (ventasConMedioDesconocido.length > 0) {
    console.log(`\n⚠️  VENTAS CON MEDIO DE PAGO DESCONOCIDO (NO SUMAN EN NINGÚN LADO):`);
    ventasConMedioDesconocido.forEach(v => {
      console.log(`    Pedido: ${v.pedido} | Medio: "${v.medio}" | Total: ${COP(v.total)}`);
    });
  }

  // ── 5. Ventas por categoría ────────────────────────────────────────────────
  console.log(`\n📦  VENTAS POR CATEGORÍA (desde la BD)`);
  console.log(hr());
  const catMap = {};
  for (const v of allVentas) {
    for (const ov of v.ordenVentas) {
      const cat = ov.categoriaProducto || ov.categoria || 'Sin categoría';
      const nombre = ov.nombreProducto || ov.nombre || 'N/A';
      if (!catMap[cat]) catMap[cat] = {};
      if (!catMap[cat][nombre]) catMap[cat][nombre] = { cant: 0, ingresos: 0 };
      catMap[cat][nombre].cant += ov.cantidad || 1;
      catMap[cat][nombre].ingresos += Number(ov.precioTotal || 0);
    }
  }

  let totalUnidades = 0, totalIngresos = 0;
  Object.entries(catMap)
    .sort((a, b) => {
      const ta = Object.values(a[1]).reduce((s, x) => s + x.cant, 0);
      const tb = Object.values(b[1]).reduce((s, x) => s + x.cant, 0);
      return tb - ta;
    })
    .forEach(([cat, productos]) => {
      const catCant = Object.values(productos).reduce((s, x) => s + x.cant, 0);
      const catIng  = Object.values(productos).reduce((s, x) => s + x.ingresos, 0);
      totalUnidades += catCant;
      totalIngresos += catIng;
      console.log(`\n  📂 ${cat}  (${catCant} uds, ${COP(catIng)})`);
      Object.entries(productos)
        .sort((a, b) => b[1].cant - a[1].cant)
        .forEach(([nombre, d]) => {
          console.log(`      ${String(d.cant).padStart(4)} x ${nombre.padEnd(35)} ${COP(d.ingresos)}`);
        });
    });
  console.log(`\n  TOTAL UNIDADES              : ${totalUnidades}`);
  console.log(`  TOTAL INGRESOS (orderventas): ${COP(totalIngresos)}`);

  // ── 6. Rango de pedidos ───────────────────────────────────────────────────
  if (allVentas.length > 0) {
    console.log(`\n🔢  RANGO DE PEDIDOS`);
    console.log(`    Primer pedido: ${allVentas[0].pedido || 'N/A'} a las ${allVentas[0].hora || 'N/A'}`);
    console.log(`    Último pedido: ${allVentas[allVentas.length-1].pedido || 'N/A'} a las ${allVentas[allVentas.length-1].hora || 'N/A'}`);
    console.log(`    Total pedidos: ${allVentas.length}`);

    // Ventas con totalInput en 0 o nulo (posibles fantasmas)
    const ventasVacias = allVentas.filter(v => !v.totalInput || Number(v.totalInput) === 0);
    if (ventasVacias.length > 0) {
      console.log(`\n⚠️  VENTAS PAGADAS CON TOTAL = $0 (POSIBLES FANTASMAS):`);
      ventasVacias.forEach(v => {
        console.log(`    Pedido: ${v.pedido} | Estado: ${v.estado} | Medio: ${v.medioDePago} | Hora: ${v.hora} | FechaHora: ${v.fechaYHora?.toISOString()}`);
      });
    } else {
      console.log(`\n✅  No hay ventas con total $0 entre las ventas PAGADAS/ENTREGADAS.`);
    }
  }

  // ── 7. Ventas eliminadas del período ──────────────────────────────────────
  if (ventasEliminadas.length > 0) {
    console.log(`\n🗑️   VENTAS ELIMINADAS (SOFT DELETE) DEL DÍA:`);
    console.log(`    (Estas NO cuentan en los totales. Confirmación de que el filtro funciona.)`);
    ventasEliminadas.forEach(v => {
      console.log(`    Pedido: ${v.pedido} | Estado: ${v.estado} | Total: ${COP(v.totalInput)} | Eliminado: ${v.deletedAt?.toISOString().slice(0,19)} | Por: ${v.deletedBy || 'N/A'}`);
    });
  }

  // ── 8. Ventas fuera del rango pero relacionadas a la caja ─────────────────
  const ventasCaja = await prisma.ventas.findMany({
    where: {
      aperturaCierreCaja: { some: { IDcaja: caja.IDcaja } },
      deletedAt: null,
    },
  });

  const idsEnRango = new Set(allVentas.map(v => v.IDventas));
  const ventasRelacionadasFueraRango = ventasCaja.filter(v => !idsEnRango.has(v.IDventas));
  if (ventasRelacionadasFueraRango.length > 0) {
    console.log(`\n⚠️  VENTAS RELACIONADAS A ESTA CAJA PERO FUERA DEL RANGO DE FECHA:`);
    ventasRelacionadasFueraRango.forEach(v => {
      console.log(`    Pedido: ${v.pedido} | Estado: ${v.estado} | Total: ${COP(v.totalInput)} | Fecha: ${v.fechaYHora?.toISOString()}`);
    });
  }

  // ── 9. Modificadores negativos ─────────────────────────────────────────────
  console.log(`\n🏷️   ANÁLISIS DE MODIFICADORES (notas con precio)`);
  console.log(hr());
  let totalModificadoresSuma = 0;
  const modificadoresMap = {};

  for (const v of allVentas) {
    for (const ov of v.ordenVentas) {
      if (!ov.comentarios) continue;
      try {
        const parsed = JSON.parse(ov.comentarios);
        const notas = Array.isArray(parsed) ? parsed : [];
        notas.forEach(n => {
          const precio = Number(n.price || n.precio || n.Precio || 0);
          const nombre = n.name || n.nombre || n.Nombre || String(n);
          const cant   = Number(n.quantity || n.cantidad || 1);
          if (precio !== 0) {
            const key = `${nombre} (${COP(precio)} c/u)`;
            modificadoresMap[key] = (modificadoresMap[key] || 0) + cant;
            totalModificadoresSuma += precio * cant;
          }
        });
      } catch (_) {}
    }
  }

  if (Object.keys(modificadoresMap).length === 0) {
    console.log('  No hay modificadores con precio en este período.');
  } else {
    Object.entries(modificadoresMap)
      .sort((a, b) => b[1] - a[1])
      .forEach(([k, v]) => {
        const precio = Number(k.match(/\(([^)]+)\)/)?.[1]?.replace(/[$.]/g,'').replace(/\./g,'') || 0);
        console.log(`    ${String(v).padStart(4)}x  ${k.padEnd(40)}  subtotal: ${COP(precio * v)}`);
      });
    console.log(`\n  IMPACTO TOTAL MODIFICADORES : ${COP(totalModificadoresSuma)}`);
  }

  // ── 10. Resumen comparativo con la app ─────────────────────────────────────
  console.log(`\n${'═'.repeat(70)}`);
  console.log(`  📋  RESUMEN COMPARATIVO  APP vs BASE DE DATOS`);
  console.log('═'.repeat(70));
  console.log(`  CONCEPTO                      APP               BD (auditoria)`);
  console.log(hr());
  console.log(`  Total efectivo esperado       ${COP(caja.efectivoDeCierre || 0)}`.padEnd(50) + `${COP(totalEfectivoEsperado)}`);
  console.log(`  Total transf. esperado        ${COP(caja.transferenciasContadas || 0)}`.padEnd(50) + `${COP(totalTransferenciasApp)}`);
  console.log(`  Unidades vendidas             118 (ver app)`.padEnd(50) + `${totalUnidades}`);
  console.log(hr('═'));

  console.log(`\n✅  Auditoría completada.\n`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error('Error en auditoría:', e);
  await prisma.$disconnect();
  process.exit(1);
});
