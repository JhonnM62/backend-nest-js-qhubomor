import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const johana = await prisma.usuarios.findFirst({
    where: { nombre: { contains: 'johana', mode: 'insensitive' } }
  });
  if (!johana) {
    console.log("No johana found");
    return;
  }
  const turnos = await prisma.turnos.findMany({
    where: { usuarioId: johana.IDusuarios }
  });
  console.log("Turnos de Johana:", JSON.stringify(turnos, null, 2));
  
  const descuentos = await prisma.descuentosEmpleado.findMany({
    where: { usuarioId: johana.IDusuarios }
  });
  console.log("Descuentos de Johana:", JSON.stringify(descuentos, null, 2));
}

main().catch(e => console.error(e)).finally(() => prisma.$disconnect());
