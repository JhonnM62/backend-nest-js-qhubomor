import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  const email = 'admin@fogata.com';
  const password = 'admin'; // Cambia esta contraseña si lo deseas
  const nombre = 'Admin Fogata';

  console.log(`Buscando usuario con email: ${email}`);

  let usuario = await prisma.usuarios.findFirst({
    where: { email },
  });

  if (usuario) {
    console.log('El usuario ya existe, actualizando su rol a "Admin app"...');
    usuario = await prisma.usuarios.update({
      where: { IDusuarios: usuario.IDusuarios },
      data: { rol: 'Admin app' },
    });
    console.log('¡Usuario actualizado exitosamente!');
  } else {
    console.log('El usuario no existe, creándolo...');
    const hashedPassword = await bcrypt.hash(password, 10);
    
    usuario = await prisma.usuarios.create({
      data: {
        nombre,
        email,
        password: hashedPassword,
        rol: 'Admin app',
        isActive: true,
      },
    });
    console.log('¡Usuario administrador creado exitosamente!');
    console.log(`Email: ${email}`);
    console.log(`Contraseña: ${password}`);
  }
}

main()
  .catch((e) => {
    console.error('Error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
