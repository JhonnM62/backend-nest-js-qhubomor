import { PrismaClient } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient();
  
  const descuentos = await prisma.descuentosEmpleado.findMany({
    where: { concepto: 'LLEGADA_TARDE' },
    include: { turno: true },
  });
  
  let updated = 0;
  for (const desc of descuentos) {
    if (desc.turno && desc.fecha.getTime() !== desc.turno.fecha.getTime()) {
      await prisma.descuentosEmpleado.update({
        where: { IDdescuento: desc.IDdescuento },
        data: { fecha: desc.turno.fecha },
      });
      updated++;
    }
  }
  
  console.log(`Updated ${updated} discounts.`);
  await prisma.$disconnect();
}

main().catch(console.error);
