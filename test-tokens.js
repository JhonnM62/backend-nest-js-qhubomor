const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  const tokens = await prisma.pushToken.findMany();
  console.log(tokens);
}
main().finally(() => prisma.$disconnect());