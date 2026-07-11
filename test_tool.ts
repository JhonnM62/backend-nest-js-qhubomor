import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const args = {
    fechaInicio: "2026-06-01",
    fechaFin: "2026-06-30",
    tipoMovimiento: "salidas",
    insumo: "chicle"
  };

  const parseDate = (dateStr: string) => {
    if (!dateStr) return new Date().toISOString().split('T')[0];
    const str = dateStr.toLowerCase();
    const d = new Date();
    d.setHours(d.getHours() - 5);
    if (str === 'hoy') return d.toISOString().split('T')[0];
    if (str === 'ayer') {
        d.setDate(d.getDate() - 1);
        return d.toISOString().split('T')[0];
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
    return d.toISOString().split('T')[0];
  };

  const fInicio = parseDate(args.fechaInicio);
  const fFin = parseDate(args.fechaFin);

  const startDate = new Date(`${fInicio}T05:00:00.000Z`);
  const nextDay = new Date(`${fFin}T05:00:00.000Z`);
  nextDay.setDate(nextDay.getDate() + 1);
  const endDate = new Date(nextDay.getTime() - 1);

  let whereClause: any = {
    fechaYHora: { gte: startDate, lte: endDate }
  };

  if (args.tipoMovimiento === 'entradas') {
    whereClause.seCompro = 'Si';
  } else if (args.tipoMovimiento === 'salidas') {
    whereClause.seCompro = 'No';
  } else {
    whereClause.seCompro = { in: ['Si', 'No'] }; 
  }

  if (args.insumo) {
    whereClause.nombreDelAlimento = { contains: args.insumo, mode: 'insensitive' };
  }

  const movimientos = await prisma.orderinventario.findMany({
    where: whereClause,
    select: { nombreDelAlimento: true, cantidad: true, seCompro: true }
  });

  const totales = new Map<string, { entradas: number, salidas: number }>();
  for (const mov of movimientos) {
    const nombre = mov.nombreDelAlimento || 'Desconocido';
    const cantidad = Number(mov.cantidad) || 0;
    const esEntrada = mov.seCompro === 'Si';
    
    if (!totales.has(nombre)) {
        totales.set(nombre, { entradas: 0, salidas: 0 });
    }
    
    const current = totales.get(nombre)!;
    if (esEntrada) current.entradas += cantidad;
    else current.salidas += cantidad;
  }

  if (totales.size === 0) {
      console.log(`No se encontraron registros de ${args.tipoMovimiento}${args.insumo ? ` para '${args.insumo}'` : ''} entre el ${args.fechaInicio} y el ${args.fechaFin}.`);
      return;
  }

  let resumen = `Resumen de ${args.tipoMovimiento}${args.insumo ? ` para '${args.insumo}'` : ''} (${args.fechaInicio} a ${args.fechaFin}):\n\n`;
  const sortedKeys = Array.from(totales.keys()).sort();
  for (const key of sortedKeys) {
      const { entradas, salidas } = totales.get(key)!;
      if (args.tipoMovimiento === 'entradas' && entradas > 0) {
        resumen += `- ${key}: ${entradas} comprados/ingresados\n`;
      } else if (args.tipoMovimiento === 'salidas' && salidas > 0) {
        resumen += `- ${key}: ${salidas} consumidos/gastados\n`;
      } else if (args.tipoMovimiento === 'ambos') {
        resumen += `- ${key}: Entradas: ${entradas} | Salidas: ${salidas}\n`;
      }
  }
  
  console.log(resumen);
}

main().catch(console.error).finally(() => prisma.$disconnect());
