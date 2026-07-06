import { PrismaClient } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient();
  const id1 = 'cmr4hkswc00ldczh876rq19ze';
  const id2 = 'cmr5dxu9z00mnczh8c9ibw70a';

  const t1 = await prisma.turnos.findUnique({ where: { IDturno: id1 }, include: { descuentos: true } });
  const t2 = await prisma.turnos.findUnique({ where: { IDturno: id2 }, include: { descuentos: true } });

  console.log('--- TURNO 1 ---');
  console.log(JSON.stringify(t1, null, 2));
  console.log('--- TURNO 2 ---');
  console.log(JSON.stringify(t2, null, 2));

  // If one of them has no horaSalida and no observation, and the other is complete, maybe delete the wrong one?
  // Let's just output them first.
}

main().catch(console.error);
