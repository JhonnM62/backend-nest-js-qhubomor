const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const prods = await prisma.productos.findMany({
    where: { OR: [ { nombre: { contains: "Des P" } }, { nombre: { contains: "Rechimba" } }, { nombre: { contains: "12 onz" } } ] },
    include: { categoriaRelacion: true }
  });
  console.log("Productos:", JSON.stringify(prods, null, 2));

  const ventas = await prisma.ventas.findMany({
    orderBy: { IDventas: 'desc' },
    take: 1,
    include: { ordenVentas: { include: { producto: { include: { categoriaRelacion: true } } } } }
  });
  console.log("Ultima venta:", JSON.stringify(ventas[0].ordenVentas, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
