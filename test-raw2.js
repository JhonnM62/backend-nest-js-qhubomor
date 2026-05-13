const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  try {
    const result = await prisma.$queryRawUnsafe(`SELECT * FROM "APERTURA Y CIERRE DE CAJA" LIMIT 1;`);
    console.log("Data:", result);
  } catch (error) {
    console.error("Error:", error);
  } finally {
    await prisma.$disconnect();
  }
}

main();