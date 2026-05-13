const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  try {
    const caja = await prisma.aperturaCierreCaja.findFirst({
      select: {
        IDcaja: true,
        nombre: true,
      }
    });
    console.log(caja);
  } catch (error) {
    console.error("Error:", error.message);
  } finally {
    await prisma.$disconnect();
  }
}

main();