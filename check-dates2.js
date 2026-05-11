const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkVentasDates() {
  const ventas = await prisma.ventas.findMany({
    where: {
      fecha: {
        gte: new Date('2025-11-20T00:00:00.000Z'),
        lte: new Date('2026-01-02T00:00:00.000Z')
      }
    },
    select: {
      fecha: true,
      totalInput: true
    }
  });

  const countsByUTCString = {};
  ventas.forEach(v => {
    const s = v.fecha.toISOString();
    if (!countsByUTCString[s]) countsByUTCString[s] = 0;
    countsByUTCString[s]++;
  });

  console.log('Unique UTC dates in DB and their counts:');
  Object.keys(countsByUTCString).sort().forEach(k => {
    console.log(`${k} : ${countsByUTCString[k]} ventas`);
  });
}

checkVentasDates()
  .catch(e => console.error(e))
  .finally(() => prisma.$disconnect());
