const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  const alitas = await prisma.productos.findMany({
    where: { nombre: { contains: 'Alita', mode: 'insensitive' } },
    include: {
      recetaInsumos: {
        include: { insumoRelacion: true }
      }
    }
  });
  console.log(JSON.stringify(alitas, null, 2));
}
main().finally(() => prisma.$disconnect());
