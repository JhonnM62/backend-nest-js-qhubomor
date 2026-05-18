const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  const settings = await prisma.notificationSetting.findMany();
  console.log(settings);
}
main().finally(() => prisma.$disconnect());