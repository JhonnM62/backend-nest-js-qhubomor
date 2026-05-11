import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Listando todos los usuarios:\n');

  const usuarios = await prisma.usuarios.findMany({
    orderBy: { nombre: 'asc' },
    select: {
      IDusuarios: true,
      nombre: true,
      email: true,
      rol: true,
    },
  });

  usuarios.forEach((u) => {
    console.log(`ID: ${u.IDusuarios}`);
    console.log(`  Nombre: ${u.nombre}`);
    console.log(`  Email: ${u.email}`);
    console.log(`  Rol: ${u.rol}`);
    console.log('');
  });

  console.log(`Total de usuarios: ${usuarios.length}`);
}

main()
  .catch((e) => {
    console.error('Error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });