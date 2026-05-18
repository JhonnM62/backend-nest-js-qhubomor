const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  const user = await prisma.usuarios.findUnique({ where: { IDusuarios: 'cmom4whz80000k0qnjs8qb3sc' } });
  console.log(user.rol);
}
main().finally(() => prisma.$disconnect());