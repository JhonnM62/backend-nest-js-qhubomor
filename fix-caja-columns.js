const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  try {
    await prisma.$executeRawUnsafe(`ALTER TABLE "APERTURA Y CIERRE DE CAJA" ADD COLUMN IF NOT EXISTS "Hora Congelada" TEXT;`);
    await prisma.$executeRawUnsafe(`ALTER TABLE "APERTURA Y CIERRE DE CAJA" ADD COLUMN IF NOT EXISTS "Hora en la que se actualizo" TIMESTAMP(3);`);
    await prisma.$executeRawUnsafe(`ALTER TABLE "APERTURA Y CIERRE DE CAJA" ADD COLUMN IF NOT EXISTS "Contador" INTEGER;`);
    await prisma.$executeRawUnsafe(`ALTER TABLE "APERTURA Y CIERRE DE CAJA" ADD COLUMN IF NOT EXISTS "Contador 2" INTEGER;`);
    await prisma.$executeRawUnsafe(`ALTER TABLE "APERTURA Y CIERRE DE CAJA" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3);`);
    await prisma.$executeRawUnsafe(`ALTER TABLE "APERTURA Y CIERRE DE CAJA" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3);`);
    console.log("Columnas agregadas a APERTURA Y CIERRE DE CAJA.");
  } catch (error) {
    console.error("Error:", error);
  } finally {
    await prisma.$disconnect();
  }
}

main();