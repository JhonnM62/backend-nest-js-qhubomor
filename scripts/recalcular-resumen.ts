import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Iniciando recálculo del campo resumen en AperturaCierreCaja...');
  
  const cajas = await prisma.aperturaCierreCaja.findMany({
    where: {
      OR: [
        { resumen: null },
        { resumen: 0 }
      ]
    }
  });

  console.log(`Se encontraron ${cajas.length} cajas para actualizar.`);
  let actualizadas = 0;

  for (const caja of cajas) {
    if (caja.efectivoDeCierre !== null && caja.efectivoDeApertura !== null) {
      const efCierre = Number(caja.efectivoDeCierre);
      const efApertura = Number(caja.efectivoDeApertura);
      const resumen = efCierre - efApertura;

      await prisma.aperturaCierreCaja.update({
        where: { IDcaja: caja.IDcaja },
        data: { resumen }
      });
      actualizadas++;
      
      if (actualizadas % 50 === 0) {
        console.log(`Progreso: ${actualizadas} cajas actualizadas...`);
      }
    }
  }

  console.log(`\n¡Proceso terminado! Se actualizaron exitosamente ${actualizadas} registros de ${cajas.length} cajas encontradas.`);
}

main()
  .catch((e) => {
    console.error('Error durante la ejecución del script:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
