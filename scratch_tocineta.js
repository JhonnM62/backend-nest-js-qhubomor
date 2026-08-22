const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  const tocineta = await prisma.insumos.findFirst({
    where: { nombre: { contains: 'Tocineta' } }
  });
  console.log("Tocineta Insumo:", tocineta);
}
main().finally(() => prisma.$disconnect());
