const { PrismaClient } = require('./node_modules/@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const personales = await prisma.gastosPersonales.findMany();
  console.log('Gastos Personales Count:', personales.length);
  if (personales.length > 0) {
    console.log(personales[0]);
  }
}
main().finally(() => prisma.$disconnect());
