import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const insumos = await prisma.insumos.findMany({
    where: { nombre: { contains: 'chicle', mode: 'insensitive' } }
  });
  console.log("Total chicle insumos:", insumos.length);
  for (const i of insumos) {
    console.log(`[${i.IDalimentos}] ${i.nombre} | Disp: ${i.disponible} | DescVentas: ${i.descontarCantDeVentas}`);
  }
}

main()
  .catch(e => console.error(e))
  .finally(() => prisma.$disconnect());
