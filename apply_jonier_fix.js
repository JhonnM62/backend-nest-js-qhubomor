const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function fix() {
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

  const nombresInsumos = [...new Set(entradasHoy.map(e => e.nombreDelAlimento))];
  let fixedCount = 0;

  for (const nombre of nombresInsumos) {
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
      const insumo = await prisma.insumos.findFirst({
        where: { nombre: nombre }
      });

      if (insumo) {
        // Actualizar stock
        const nuevoStock = insumo.disponible - sumaSalidas;
        const nuevaCantidad = insumo.cantidad - sumaSalidas;
        
        await prisma.insumos.update({
          where: { IDalimentos: insumo.IDalimentos },
          data: {
            disponible: nuevoStock,
            cantidad: nuevaCantidad
          }
        });

        // Registrar la corrección en el historial para auditoría
        await prisma.orderinventario.create({
          data: {
            categoria: insumo.categoria,
            nombreCategoria: insumo.nombreCategoria,
            nombreDelAlimento: insumo.nombre,
            cantidad: sumaSalidas,
            observacion: 'Corrección automática: Resta de salidas de Julieta (lunes) que se omitieron al reingresar base manual',
            disponible: 'No',
            fechaYHora: new Date(),
            seCompro: 'No'
          }
        });

        console.log(`Corregido ${nombre}: Restadas ${sumaSalidas} unidades. Nuevo stock: ${nuevoStock}`);
        fixedCount++;
      }
    }
  }

  console.log(`\n¡Corrección completada! ${fixedCount} insumos fueron actualizados exitosamente.`);
}

fix().finally(() => prisma.$disconnect());
