import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const users = await prisma.user.findMany({
    where: { nombre: { contains: 'Johana', mode: 'insensitive' } },
    select: { id: true, nombre: true, rol: true }
  });
  
  console.log('Usuarios encontrados:', users);

  for (const u of users) {
    const turnos = await prisma.turnoEmpleado.findMany({
      where: { usuarioId: u.id },
      orderBy: { fechaInicio: 'desc' },
      take: 5
    });
    console.log(`\nTurnos de ${u.nombre}:`, JSON.stringify(turnos, null, 2));

    const descuentos = await prisma.descuentosEmpleado.findMany({
      where: { usuarioId: u.id },
      orderBy: { fecha: 'desc' },
      take: 5
    });
    console.log(`\nDescuentos de ${u.nombre}:`, JSON.stringify(descuentos, null, 2));
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
