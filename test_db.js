const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const cajas = await prisma.aperturaCierreCaja.findMany({
    orderBy: { createdAt: 'desc' },
    take: 5,
    select: {
      IDcaja: true,
      nombre: true,
      fechaDeApertura: true,
      fechaDeCierre: true,
      createdAt: true,
    }
  });
  console.log("Cajas:", cajas);

  const ventas = await prisma.ventas.findMany({
    orderBy: { fechaYHora: 'desc' },
    take: 10,
    select: {
      IDventas: true,
      fecha: true,
      fechaYHora: true,
      pedido: true,
    }
  });
  console.log("Ventas:", ventas);
}

main().finally(() => prisma.$disconnect());
