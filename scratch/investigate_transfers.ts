import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function run() {
  const start = new Date('2026-08-01T00:00:00.000Z');
  const end = new Date('2026-08-17T23:59:59.999Z');

  // Obtener ventas
  const ventas = await prisma.ventas.findMany({
    where: {
      fecha: { gte: start, lte: end },
      estado: { not: 'ANULADO' },
    },
    select: {
      fecha: true,
      totalInput: true,
      valorDeTransferencia: true,
      medioDePago: true,
    }
  });

  // Agrupar ventas por día
  const transferenciasPorDiaVentas: Record<string, number> = {};

  ventas.forEach((v) => {
    if (!v.fecha) return;
    const d = v.fecha;
    const year = d.getUTCFullYear();
    const month = (d.getUTCMonth() + 1).toString().padStart(2, '0');
    const day = d.getUTCDate().toString().padStart(2, '0');
    const dateStr = `${year}-${month}-${day}`;

    if (!transferenciasPorDiaVentas[dateStr]) {
      transferenciasPorDiaVentas[dateStr] = 0;
    }

    const medio = (v.medioDePago || '').toUpperCase();
    if (['TRANSFERENCIA', 'NEQUI', 'DAVIPLATA', 'BANCOLOMBIA', 'TARJETA'].includes(medio)) {
      transferenciasPorDiaVentas[dateStr] += Number(v.totalInput || 0);
    } else {
      transferenciasPorDiaVentas[dateStr] += Number(v.valorDeTransferencia || 0);
    }
  });

  // Obtener cajas
  const cajas = await prisma.aperturaCierreCaja.findMany({
    where: {
      fechaDeCierre: { gte: start, lte: end },
    },
    select: {
      fechaDeCierre: true,
      transferenciasContadas: true,
      IDcaja: true,
    }
  });

  // Agrupar cajas por día
  const transferenciasPorDiaCaja: Record<string, number> = {};

  cajas.forEach((c) => {
    if (!c.fechaDeCierre) return;
    // Asumiendo que la caja se cierra el mismo día, o usando UTC
    const d = c.fechaDeCierre;
    const year = d.getUTCFullYear();
    const month = (d.getUTCMonth() + 1).toString().padStart(2, '0');
    // Para la caja, vamos a usar getUTCDate() aunque a veces el cierre pasa la medianoche.
    // Usaremos la fecha local de Colombia para agrupar (UTC-5)
    // Para no complicarnos, restamos 5 horas al UTC
    const localD = new Date(d.getTime() - 5 * 60 * 60 * 1000);
    const localYear = localD.getUTCFullYear();
    const localMonth = (localD.getUTCMonth() + 1).toString().padStart(2, '0');
    const localDay = localD.getUTCDate().toString().padStart(2, '0');
    
    const dateStr = `${localYear}-${localMonth}-${localDay}`;

    if (!transferenciasPorDiaCaja[dateStr]) {
      transferenciasPorDiaCaja[dateStr] = 0;
    }
    transferenciasPorDiaCaja[dateStr] += Number(c.transferenciasContadas || 0);
  });

  // Generar reporte combinado
  const allDates = Array.from(new Set([...Object.keys(transferenciasPorDiaVentas), ...Object.keys(transferenciasPorDiaCaja)])).sort();

  const markdown = [
    `# Comparación Diaria de Transferencias (1 Ago - 17 Ago 2026)`,
    ``,
    `| Fecha | Total Ventas (Sistema) | Total Caja (Contado) | Diferencia (Caja - Ventas) |`,
    `|---|---|---|---|`
  ];

  let totalVentas = 0;
  let totalCaja = 0;

  allDates.forEach(date => {
    const v = transferenciasPorDiaVentas[date] || 0;
    const c = transferenciasPorDiaCaja[date] || 0;
    const diff = c - v;
    
    totalVentas += v;
    totalCaja += c;

    const diffStr = diff === 0 ? '✅ $0' : `⚠️ $${diff.toLocaleString()}`;

    markdown.push(`| ${date} | $${v.toLocaleString()} | $${c.toLocaleString()} | ${diffStr} |`);
  });

  markdown.push(`| **TOTALES** | **$${totalVentas.toLocaleString()}** | **$${totalCaja.toLocaleString()}** | **$${(totalCaja - totalVentas).toLocaleString()}** |`);

  const fs = require('fs');
  fs.writeFileSync('C:/Users/Administrador/.gemini/antigravity-ide/brain/7ea950a7-8ac0-4c7a-8ca9-7da6cf221958/reporte_diario_transferencias.md', markdown.join('\\n'));
  
  console.log('Reporte diario generado exitosamente.');
  await prisma.$disconnect();
}

run().catch(e => {
  console.error(e);
  prisma.$disconnect();
  process.exit(1);
});
