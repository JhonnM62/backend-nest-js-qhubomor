const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const venta = await prisma.ventas.findFirst({
    where: { pedido: 'V.R-C-203' },
    select: { IDventas: true, pedido: true, fecha: true, fechaYHora: true, createdAt: true, hora: true }
  });
  console.log('Venta 203:', venta);
}

main().finally(() => prisma.$disconnect());
