import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  try {
    console.log('Adding missing columns to USUARIOS table...');
    
    // Add password column
    await prisma.$executeRawUnsafe(`ALTER TABLE "USUARIOS" ADD COLUMN IF NOT EXISTS "password" TEXT;`);
    console.log('Added password column.');

    // Add isActive column
    await prisma.$executeRawUnsafe(`ALTER TABLE "USUARIOS" ADD COLUMN IF NOT EXISTS "isActive" BOOLEAN;`);
    console.log('Added isActive column.');

    // Add createdAt column
    await prisma.$executeRawUnsafe(`ALTER TABLE "USUARIOS" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP;`);
    console.log('Added createdAt column.');

    // Add updatedAt column
    await prisma.$executeRawUnsafe(`ALTER TABLE "USUARIOS" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3);`);
    console.log('Added updatedAt column.');

    console.log('Done fixing the database.');
  } catch (error) {
    console.error('Error fixing DB:', error);
  } finally {
    await prisma.$disconnect();
  }
}

main();