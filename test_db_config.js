const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const config = await prisma.configuracionNegocio.findUnique({ where: { id: 1 } });
  console.log("Configuracion:", config);

  const ventas = await prisma.ventas.findMany({
    orderBy: { fechaYHora: 'desc' },
    take: 50,
    select: {
      IDventas: true,
      fecha: true,
      fechaYHora: true,
      pedido: true,
    }
  });

  // Find a sale around 2 AM to see what its 'fecha' is
  const earlyMorningSales = ventas.filter(v => v.fechaYHora && v.fechaYHora.getUTCHours() >= 5 && v.fechaYHora.getUTCHours() <= 9); // UTC 5-9 is Local 0-4 AM
  console.log("Early morning sales:", earlyMorningSales);
}

main().finally(() => prisma.$disconnect());
