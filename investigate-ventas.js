const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function investigate() {
  const start = new Date('2025-12-01T00:00:00.000Z');
  const end = new Date('2025-12-31T23:59:59.999Z');

  const ventas = await prisma.ventas.findMany({
    where: {
      fecha: {
        gte: start,
        lte: end
      }
    },
    select: {
      fecha: true,
      totalInput: true,
      IDventas: true
    },
    orderBy: {
      fecha: 'asc'
    }
  });

  console.log(`Total ventas in Dec 2025: ${ventas.length}`);
  
  // Group by date to see the distribution
  const byDate = {};
  ventas.forEach(v => {
    const dateStr = v.fecha.toISOString().split('T')[0];
    if (!byDate[dateStr]) byDate[dateStr] = { count: 0, total: 0 };
    byDate[dateStr].count++;
    byDate[dateStr].total += Number(v.totalInput || 0);
  });

  console.log('--- Ventas by Date (UTC) ---');
  Object.entries(byDate).forEach(([date, stats]) => {
    console.log(`${date}: ${stats.count} ventas, Total: ${stats.total}`);
  });

  // Let's check the values that might look like "1.24"
  console.log('--- Sample values ---');
  ventas.slice(0, 5).forEach(v => {
    console.log(`ID: ${v.IDventas}, fecha: ${v.fecha.toISOString()}, totalInput: ${v.totalInput} (Number: ${Number(v.totalInput)})`);
  });
}

investigate()
  .catch(e => console.error(e))
  .finally(() => prisma.$disconnect());
