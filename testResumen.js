const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  const caja = await prisma.aperturaCierreCaja.findFirst({ where: { cierre: 'abierta' }});
  if (!caja) return console.log("No caja abierta");
  
  let fechaInicio = new Date(caja.fechaDeApertura);
  fechaInicio.setUTCHours(5, 0, 0, 0);
  let fechaFin = new Date();
  
  const allVentas = await prisma.ventas.findMany({
    where: { 
      estado: { in: ['PAGADO', 'ENTREGADO'] },
      deletedAt: null,
      fechaYHora: { gte: fechaInicio, lte: fechaFin }
    },
    include: { ordenVentas: true }
  });
  
  const notasAnalysis = [];
  allVentas.forEach(v => {
    let ventaHasNotes = false;
    const ventaNotes = [];
    v.ordenVentas.forEach(ov => {
      if (ov.comentarios) {
        try {
          const parsed = JSON.parse(ov.comentarios);
          if (Array.isArray(parsed) && parsed.length > 0) {
            ventaHasNotes = true;
            ventaNotes.push({ producto: ov.nombre || 'Producto', notas: parsed });
          } else if (typeof parsed === 'string' && parsed.trim().length > 0) {
            ventaHasNotes = true;
            ventaNotes.push({ producto: ov.nombre || 'Producto', notas: [{nombre: parsed, precio: 0}]});
          }
        } catch(e) {
          ventaHasNotes = true;
          ventaNotes.push({ producto: ov.nombre || 'Producto', notas: [{nombre: ov.comentarios, precio: 0}]});
        }
      }
    });
    if (ventaHasNotes) {
      notasAnalysis.push({ pedido: v.pedido, productosConNotas: ventaNotes });
    }
  });
  console.log(JSON.stringify(notasAnalysis, null, 2));
}
main().finally(() => prisma.$disconnect());