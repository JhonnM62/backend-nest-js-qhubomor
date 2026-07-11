import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const movs = await prisma.orderinventario.findMany({
    where: { nombreDelAlimento: { contains: 'chicle', mode: 'insensitive' } },
    include: { inventario: true }
  });
  console.log("Total chicle items:", movs.length);
  for (const m of movs) {
    console.log(`[${m.fechaYHora?.toISOString()}] ${m.nombreDelAlimento} | Cant: ${m.cantidad} | seCompro: ${m.seCompro} | InvTipo: ${m.inventario?.tipo} | Obs: ${m.observacion}`);
  }
}

main()
  .catch(e => console.error(e))
  .finally(() => prisma.$disconnect());
