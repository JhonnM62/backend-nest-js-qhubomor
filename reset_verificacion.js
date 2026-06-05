const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const cajaIdToReset = 'cmpzutxjb000t5dsdjd6ox35q';
  
  const insumos = await prisma.insumos.findMany({
    where: { cuadrarInsumos: true }
  });
  
  for (const insumo of insumos) {
    const conteosActuales = insumo.ultimosConteos || [];
    if (!Array.isArray(conteosActuales)) continue;
    
    const conteosFiltrados = conteosActuales.filter(c => c.cajaId !== cajaIdToReset);
    
    if (conteosFiltrados.length !== conteosActuales.length) {
      await prisma.insumos.update({
        where: { IDalimentos: insumo.IDalimentos },
        data: { ultimosConteos: conteosFiltrados }
      });
      console.log(`Reset verification for insumo ${insumo.nombre}`);
    }
  }
  
  console.log('Verification reset complete.');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
