import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function testCreateMesa() {
  try {
    const mesa = await prisma.mesas.create({
      data: {
        nombre: 'M1',
        posX: 0,
        posY: 0,
        width: 100,
        height: 100,
        tipo: 'MESA'
      }
    });
    console.log('Mesa created:', mesa);
  } catch (error) {
    console.error('Error creating mesa:', error);
  } finally {
    await prisma.$disconnect();
  }
}

testCreateMesa();
