const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function run() {
  console.log('1. Restableciendo las cantidades en la tabla INSUMOS a 0...');
  const updatedInsumos = await prisma.insumos.updateMany({
    data: { 
      cantidad: 0, 
      disponible: 0, 
      total: 0 
    }
  });
  console.log(`- Insumos actualizados: ${updatedInsumos.count}`);

  console.log('2. Eliminando registros de ORDERINVENTARIOS (Orderinventario)...');
  const deletedOrderInventarios = await prisma.orderinventario.deleteMany();
  console.log(`- Registros eliminados: ${deletedOrderInventarios.count}`);

  console.log('3. Eliminando registros de INVENTARIOS (Inventario)...');
  const deletedInventarios = await prisma.inventario.deleteMany();
  console.log(`- Registros eliminados: ${deletedInventarios.count}`);

  console.log('¡Limpieza completada con éxito!');
}

run()
  .catch((error) => {
    console.error('Error durante la limpieza:', error);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
