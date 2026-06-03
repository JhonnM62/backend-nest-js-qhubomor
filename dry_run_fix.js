const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function check() {
  // 1. Get all Insumos Jonier updated today
  const entradasHoy = await prisma.orderinventario.findMany({
    where: {
      disponible: 'Si',
      fechaYHora: { gte: new Date('2026-06-03T00:00:00.000Z') },
      OR: [
        { observacion: { contains: 'Agregado manualmente' } },
        { observacion: { contains: 'Sin observación' } }
      ]
    }
  });

  // Get distinct names
  const nombresInsumos = [...new Set(entradasHoy.map(e => e.nombreDelAlimento))];
  
  console.log(`Encontrados ${nombresInsumos.length} insumos modificados hoy.`);

  const propuestas = [];

  for (const nombre of nombresInsumos) {
    // 2. Sum Monday/Tuesday salidas
    const salidas = await prisma.orderinventario.findMany({
      where: {
        nombreDelAlimento: nombre,
        disponible: 'No',
        fechaYHora: { 
          gte: new Date('2026-06-01T00:00:00.000Z'),
          lt: new Date('2026-06-03T00:00:00.000Z')
        }
      }
    });

    const sumaSalidas = salidas.reduce((acc, curr) => acc + curr.cantidad, 0);

    if (sumaSalidas > 0) {
      // Get current insumo
      const insumo = await prisma.insumos.findFirst({
        where: { nombre: nombre }
      });

      if (insumo) {
        propuestas.push({
          insumo: nombre,
          salidasOmitidas: sumaSalidas,
          stockActual: insumo.disponible,
          nuevoStock: insumo.disponible - sumaSalidas
        });
      }
    }
  }

  console.log("Propuestas de corrección:");
  console.table(propuestas);
}

check().finally(() => prisma.$disconnect());
