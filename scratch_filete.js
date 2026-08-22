const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  const filete = await prisma.insumos.findFirst({
    where: { nombre: { contains: 'Filete de pollo', mode: 'insensitive' } }
  });
  console.log("Filete Insumo:", filete);
  
  if (filete) {
    const movs = await prisma.movimientosInsumos.findMany({
      where: { IDinsumo: filete.IDalimentos },
      orderBy: { fechaYHora: 'desc' },
      take: 10
    });
    console.log("Movimientos:", movs);
  }
}
main().finally(() => prisma.$disconnect());
