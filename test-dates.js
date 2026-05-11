const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkDates() {
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
      totalInput: true
    }
  });

  console.log(`Found ${ventas.length} ventas between 2025-12-01 and 2025-12-31`);
  
  const minDate = new Date(Math.min(...ventas.map(v => v.fecha.getTime())));
  const maxDate = new Date(Math.max(...ventas.map(v => v.fecha.getTime())));
  
  console.log(`Min date in DB for this range: ${minDate.toISOString()} (Local: ${minDate.toString()})`);
  console.log(`Max date in DB for this range: ${maxDate.toISOString()} (Local: ${maxDate.toString()})`);
  
  // Show a sample of the raw dates from DB
  console.log('Sample dates from DB:');
  ventas.slice(0, 5).forEach(v => {
    console.log(`Raw: ${v.fecha.toISOString()} -> Local: ${v.fecha.toString()}`);
  });
}

checkDates()
  .catch(e => console.error(e))
  .finally(() => prisma.$disconnect());
