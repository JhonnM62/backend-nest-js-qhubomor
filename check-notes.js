const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  const ventas = await prisma.orderventas.findMany({
    where: { comentarios: { not: null } },
    take: 5,
    orderBy: { IDorderventas: 'desc' }
  });
  console.log(JSON.stringify(ventas.map(v => v.comentarios), null, 2));
}
main().catch(console.error).finally(() => prisma.$disconnect());