import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  await prisma.$executeRawUnsafe(`ALTER TABLE "INSUMOS" ALTER COLUMN "Disponible" TYPE money USING "Disponible"::numeric::money;`);
  console.log('Converted Disponible to Money');
}

main().catch(console.error).finally(() => prisma.$disconnect());