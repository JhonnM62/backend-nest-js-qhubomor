import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const u = await prisma.usuarios.findUnique({
    where: { IDusuarios: 'cmp25e47o000m7pftb1djdd4n' }
  });
  console.log(JSON.stringify(u?.permisos, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
