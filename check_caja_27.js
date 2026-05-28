const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function check() {
  const cajas = await prisma.aperturaCierreCaja.findMany({
    where: {
      fechaDeApertura: {
        gte: new Date('2026-05-27T00:00:00.000Z'),
        lte: new Date('2026-05-28T23:59:59.000Z')
      }
    },
    orderBy: { fechaDeApertura: 'desc' }
  });

  for (const caja of cajas) {
    let fechaInicio = new Date(caja.fechaDeApertura);
    fechaInicio.setUTCHours(5, 0, 0, 0); // Ajuste a Colombia
    
    let fechaFin = caja.fechaDeCierre ? new Date(caja.fechaDeCierre) : new Date();
    if (caja.fechaDeCierre) {
      fechaFin.setUTCHours(28, 59, 59, 999);
    }
    
    const ventas = await prisma.ventas.findMany({
      where: {
        estado: { in: ['PAGADO', 'ENTREGADO'] },
        deletedAt: null,
        fechaYHora: {
          gte: fechaInicio,
          lte: fechaFin
        }
      }
    });

    console.log(`\n\n--- CAJA DEL ${caja.fechaDeApertura} ---`);
    console.log(`Ventas encontradas: ${ventas.length}`);
    
    let totalEfectivo = 0;
    let totalTransferencia = 0;
    let totalNequi = 0;
    let totalTarjeta = 0;
    
    let unaccounted = 0;
    let totalVentasPuras = 0;

    ventas.forEach(v => {
      const medio = (v.medioDePago || '').toUpperCase().replace(/_/g, ' ').trim();
      const total = Number(v.totalInput || 0);
      
      console.log(`[Venta ${v.IDventas}] ${v.pedido} | Total: ${total} | Medio: ${v.medioDePago} | EfRec: ${v.efectivoRecibido} | Banco: ${v.banco}`);
      
      totalVentasPuras += total;
      let matched = false;

      if (medio === 'EFECTIVO') { totalEfectivo += total; matched = true; }
      else if (medio === 'NEQUI') { totalNequi += total; matched = true; }
      else if (medio === 'TRANSFERENCIA' || medio === 'DAVIPLATA' || medio === 'TRASNFERENCIA') { totalTransferencia += total; matched = true; }
      else if (medio === 'TARJETA') { totalTarjeta += total; matched = true; }
      else if (medio === 'MIXTO' || medio === 'EFECTIVO Y OTROS') {
        const ef = Number(v.efectivoRecibido || 0);
        const tr = total - ef;
        totalEfectivo += ef;
        if ((v.banco || '').toUpperCase().trim() === 'NEQUI') { totalNequi += tr; }
        else { totalTransferencia += tr; }
        matched = true;
      }
      
      if (!matched) unaccounted += total;
    });

    console.log(`\n-- SUMATORIAS BACKEND --`);
    console.log(`Efectivo: ${totalEfectivo}`);
    console.log(`Transferencia: ${totalTransferencia}`);
    console.log(`Nequi: ${totalNequi}`);
    console.log(`Tarjeta: ${totalTarjeta}`);
    console.log(`Total Ventas Calculado: ${totalEfectivo + totalTransferencia + totalNequi + totalTarjeta}`);
    console.log(`Total Ventas Bruto (Suma iterada): ${totalVentasPuras}`);
    console.log(`Monto con medio de pago desconocido: ${unaccounted}`);
  }
}

check().catch(console.error).finally(() => prisma.$disconnect());
