import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Buscando ventas del 12 de junio...');
  
  // Asumiendo que la caja de ayer fue el 12 de junio
  const ventas = await prisma.ventas.findMany({
    where: {
      fechaYHora: {
        gte: new Date('2026-06-12T00:00:00.000Z'),
        lt: new Date('2026-06-13T00:00:00.000Z')
      }
    },
    select: {
      IDventas: true,
      pedido: true,
      estado: true,
      totalInput: true,
      efectivoRecibido: true,
      devueltas: true,
      medioDePago: true,
      fecha: true,
      fechaYHora: true,
      deletedAt: true
    }
  });

  console.log(`Ventas totales encontradas: ${ventas.length}`);
  
  let totalPagadoEfectivo = 0;
  let totalOtros = 0;

  for (const v of ventas) {
    if (v.deletedAt) continue;
    if (v.estado === 'PAGADO' || v.estado === 'ENTREGADO') {
      if (v.medioDePago === 'EFECTIVO' || v.medioDePago === 'EFECTIVO Y OTROS') {
        totalPagadoEfectivo += Number(v.totalInput || 0); // simplificado
      } else {
        totalOtros += Number(v.totalInput || 0);
      }
    }
  }

  console.log(`Total calculado en Efectivo: ${totalPagadoEfectivo}`);
  console.log(`Total calculado Otros Medios: ${totalOtros}`);

  const cajas = await prisma.aperturaCierreCaja.findMany({
    where: {
      fechaDeApertura: {
        gte: new Date('2026-06-12T00:00:00.000Z'),
        lt: new Date('2026-06-13T00:00:00.000Z')
      }
    }
  });

  console.log('\n--- CAJAS ---');
  for (const c of cajas) {
    console.log(`Caja: ${c.nombre} | Apertura: ${c.fechaDeApertura} | Faltante: ${c.valorFaltante} | Excedente: ${c.valorExcedente}`);
    console.log(`Efectivo Apertura: ${c.efectivoDeApertura} | Efectivo Cierre: ${c.efectivoDeCierre}`);
    console.log(`Plata Guardada: ${c.plataGuardada}`);
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
