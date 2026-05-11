import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('=== Corrigiendo usuarios con isActive NULL ===\n');

  const usuariosSinActivar = await prisma.usuarios.findMany({
    where: {
      OR: [
        { isActive: null },
        { isActive: undefined },
      ],
    },
    select: {
      IDusuarios: true,
      nombre: true,
      email: true,
      rol: true,
      isActive: true,
    },
  });

  console.log(`Encontrados ${usuariosSinActivar.length} usuarios con isActive NULL/undefined:\n`);

  for (const usuario of usuariosSinActivar) {
    console.log(`- ${usuario.nombre} (${usuario.email}) - Rol: ${usuario.rol}`);
  }

  if (usuariosSinActivar.length > 0) {
    const result = await prisma.usuarios.updateMany({
      where: {
        OR: [
          { isActive: null },
          { isActive: undefined },
        ],
      },
      data: {
        isActive: true,
      },
    });

    console.log(`\n✅ Se actualizaron ${result.count} usuarios a isActive = true`);
  } else {
    console.log('\nNo se encontraron usuarios por actualizar');
  }

  console.log('\n=== Verificando usuarios ahora ===');
  const usuarios = await prisma.usuarios.findMany({
    select: {
      IDusuarios: true,
      nombre: true,
      email: true,
      rol: true,
      isActive: true,
    },
    orderBy: { nombre: 'asc' },
  });

  console.log('\nLista de usuarios:');
  usuarios.forEach((u) => {
    console.log(`  ${u.nombre} - ${u.email} - Rol: ${u.rol} - isActive: ${u.isActive}`);
  });
}

main()
  .catch((e) => {
    console.error('Error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });