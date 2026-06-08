const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const deletedVentas = await prisma.ventas.findMany({
    where: { deletedAt: { not: null } },
    orderBy: { deletedAt: 'desc' },
    take: 10,
    include: {
      ordenVentas: {
        select: { nombreProducto: true, cantidad: true }
      }
    }
  });
  console.log('Recent deleted ventas:', JSON.stringify(deletedVentas, null, 2));

  const allOrders = await prisma.orderventas.findMany({
    orderBy: { createdAt: 'desc' },
    take: 30,
    select: { nombreProducto: true, cantidad: true, createdAt: true, IDventas: true }
  });
  console.log('Recent ordenes:', allOrders.map(o => o.nombreProducto));
}

main().finally(() => prisma.$disconnect());
