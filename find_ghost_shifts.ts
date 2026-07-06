import { PrismaClient } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient();
  const turnos = await prisma.turnos.findMany({
    orderBy: { horaEntrada: 'asc' },
    include: { usuario: true }
  });

  const map = new Map();
  let count = 0;
  for (const t of turnos) {
    const key = `${t.usuarioId}_${t.fecha.toISOString()}`;
    if (map.has(key)) {
      console.log(`DUPLICATE DETECTED:`);
      console.log(`Original: ID ${map.get(key).IDturno}, Entrada: ${map.get(key).horaEntrada}, Estado: ${map.get(key).estado}`);
      console.log(`Duplicate: ID ${t.IDturno}, Entrada: ${t.horaEntrada}, Estado: ${t.estado}`);
      count++;
    } else {
      map.set(key, t);
    }
  }

  console.log(`Found ${count} duplicate shifts.`);
}

main().catch(console.error);
