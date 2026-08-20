import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function run() {
  const mora = await prisma.orderinventario.findFirst({
    where: {
      OR: [
        { nombreDelAlimento: { contains: 'mora', mode: 'insensitive' } },
        { observacion: { contains: 'mora', mode: 'insensitive' } }
      ]
    }
  });
  console.log("Orderinventario:", mora);
  
  const insumo = await prisma.insumos.findFirst({
    where: {
      nombre: { contains: 'mora', mode: 'insensitive' }
    }
  });
  console.log("Insumo:", insumo);
}
run().finally(() => prisma.$disconnect());
