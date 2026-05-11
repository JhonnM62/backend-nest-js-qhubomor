import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const userId = 'cmom4whz80000k0qnjs8qb3sc';

  console.log('Buscando usuario con ID:', userId);

  const usuario = await prisma.usuarios.findUnique({
    where: { IDusuarios: userId },
  });

  if (!usuario) {
    console.log('Usuario no encontrado');
    return;
  }

  console.log('Usuario encontrado:', usuario.nombre);
  console.log('Email:', usuario.email);
  console.log('Rol actual:', usuario.rol);

  const usuarioActualizado = await prisma.usuarios.update({
    where: { IDusuarios: userId },
    data: {
      rol: 'Admin app',
    },
  });

  console.log('\n✅ Usuario actualizado exitosamente!');
  console.log('Nuevo rol:', usuarioActualizado.rol);
}

main()
  .catch((e) => {
    console.error('Error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });