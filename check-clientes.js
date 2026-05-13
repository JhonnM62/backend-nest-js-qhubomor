const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const allClientes = await prisma.clientes.findMany();
  console.log('All Clientes:', allClientes.length);
  
  const nullActive = allClientes.filter(c => c.isActive === null || c.isActive === undefined);
  console.log('Clientes with null/undefined isActive:', nullActive.length);

  if (nullActive.length > 0) {
    const res = await prisma.clientes.updateMany({
      where: { isActive: null },
      data: { isActive: true }
    });
    console.log('Updated to active:', res.count);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
