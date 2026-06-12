const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  await prisma.$executeRaw`ALTER TABLE "CONFIGURACION_IA" ADD COLUMN "usarRazonamiento" BOOLEAN DEFAULT false;`;
  console.log('Done');
}
main().finally(() => prisma.$disconnect());
