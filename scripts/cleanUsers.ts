import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function cleanSoftDeletedUsers() {
  try {
    const result = await prisma.usuarios.deleteMany({
      where: {
        isActive: false
      }
    });
    console.log(`Deleted ${result.count} soft-deleted users.`);
  } catch (error) {
    console.error('Error cleaning users:', error);
  } finally {
    await prisma.$disconnect();
  }
}

cleanSoftDeletedUsers();
