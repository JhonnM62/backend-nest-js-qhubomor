const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  const cajas = await prisma.aperturaCierreCaja.findMany({
    orderBy: { createdAt: 'desc' },
    take: 5
  });
  let output = '';
  for (const c of cajas) {
    if (!c.fechaDeApertura || !c.horaDeApertura) continue;
    
    // Construct Date assuming c.fechaDeApertura is a Date object
    let fechaInicioStr = c.fechaDeApertura.toISOString().split('T')[0] + 'T' + c.horaDeApertura + ':00.000Z';
    const fechaInicio = new Date(fechaInicioStr);
    
    let fechaFin;
    if (c.fechaDeCierre && c.horaDeCierre) {
      let fechaFinStr = c.fechaDeCierre.toISOString().split('T')[0] + 'T' + c.horaDeCierre + ':00.000Z';
      fechaFin = new Date(fechaFinStr);
    } else {
      fechaFin = new Date(); // If not closed, up to now
    }

    const ventas = await prisma.ventas.findMany({
      where: {
        estado: { in: ['PAGADO', 'ENTREGADO'] },
        deletedAt: null,
        fechaYHora: {
          gte: fechaInicio,
          lte: fechaFin
        }
      },
      include: {
        ordenVentas: true
      }
    });

    let total = 0;
    ventas.forEach(v => {
      total += Number(v.totalInput) || 0;
    });

    if (total === 978000) {
      output += '\n-------------------\n';
      output += 'CAJA ID: ' + c.IDcaja + '\n';
      output += 'Fecha Inicio: ' + fechaInicio.toISOString() + ' | Fecha Fin: ' + fechaFin.toISOString() + '\n';
      output += 'Total Input: ' + total + '\n';
      output += 'Ventas válidas: ' + ventas.length + '\n';
      
      ventas.forEach(v => {
        output += ' - Pedido: ' + v.pedido + ' Total: ' + v.totalInput + '\n';
        v.ordenVentas.forEach(ov => {
          output += '    > ' + ov.cantidad + 'x ' + ov.nombreProducto + '\n';
        });
      });
    }
  }
  if (output === '') {
    console.log("No caja found with exactly 978000 total");
  } else {
    console.log(output);
  }
}
main();
