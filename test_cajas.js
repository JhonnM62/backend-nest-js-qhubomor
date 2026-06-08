const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const cajas = await prisma.aperturaCierreCaja.findMany({
    orderBy: { IDcaja: 'desc' }, // or something else, let's try just getting all and sorting in memory
    take: 100,
    select: {
      IDcaja: true,
      nombre: true,
      fechaDeApertura: true,
      horaDeApertura: true,
      fechaDeCierre: true,
      createdAt: true,
      cierre: true
    }
  });
  
  // Sort by createdAt or fechaDeApertura
  cajas.sort((a, b) => {
    const dateA = a.createdAt ? a.createdAt.getTime() : (a.fechaDeApertura ? a.fechaDeApertura.getTime() : 0);
    const dateB = b.createdAt ? b.createdAt.getTime() : (b.fechaDeApertura ? b.fechaDeApertura.getTime() : 0);
    return dateB - dateA;
  });

  console.log("Latest 5 Cajas:", cajas.slice(0, 5));
}

main().finally(() => prisma.$disconnect());
