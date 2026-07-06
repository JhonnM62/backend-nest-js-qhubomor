import { PrismaClient } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient();
  const idToDelete = 'cmr4hkswc00ldczh876rq19ze';

  await prisma.descuentosEmpleado.deleteMany({ where: { turnoId: idToDelete } });
  await prisma.turnos.delete({ where: { IDturno: idToDelete } });

  console.log(`Deleted ghost shift ${idToDelete}`);
}

main().catch(console.error);
