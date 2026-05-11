const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkVentasDates() {
  // Let's get some sales around early Dec to see their exact UTC vs Local representations
  const ventas = await prisma.ventas.findMany({
    where: {
      fecha: {
        gte: new Date('2025-11-30T00:00:00.000Z'),
        lte: new Date('2026-01-02T00:00:00.000Z')
      }
    },
    select: {
      IDventas: true,
      fecha: true,
      totalInput: true
    },
    orderBy: {
      fecha: 'asc'
    }
  });

  console.log(`Total ventas found: ${ventas.length}`);
  
  // Show a sample to understand the timezone
  console.log('Sample of Ventas around Dec 1-2 and Dec 30-31:');
  ventas.filter(v => {
    const d = v.fecha.toISOString();
    return d.includes('-12-01') || d.includes('-12-02') || d.includes('-12-31') || d.includes('-01-01');
  }).slice(0, 10).forEach(v => {
    console.log(`ID: ${v.IDventas} | UTC DB: ${v.fecha.toISOString()} | Local Server: ${v.fecha.toString()} | Total: ${v.totalInput}`);
  });
}

checkVentasDates()
  .catch(e => console.error(e))
  .finally(() => prisma.$disconnect());
