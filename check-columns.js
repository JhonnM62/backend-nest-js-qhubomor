const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  try {
    const result = await prisma.$queryRawUnsafe(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'APERTURA Y CIERRE DE CAJA';
    `);
    console.log("Columnas:", result);
  } catch (error) {
    console.error("Error:", error);
  } finally {
    await prisma.$disconnect();
  }
}

main();