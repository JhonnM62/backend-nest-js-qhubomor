const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  try {
    const result = await prisma.$queryRawUnsafe(`SELECT "Hora Congelada" FROM "APERTURA Y CIERRE DE CAJA" LIMIT 1;`);
    console.log("Data:", result);
  } catch (error) {
    console.error("Postgres raw error:", error.message);
  } finally {
    await prisma.$disconnect();
  }
}

main();