const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  const lastCaja = await prisma.aperturaCierreCaja.findFirst({
    orderBy: { IDcaja: 'desc' }
  });
  console.log('Last Caja:', lastCaja);
  if (lastCaja) {
    await prisma.aperturaCierreCaja.update({
      where: { IDcaja: lastCaja.IDcaja },
      data: {
        cierre: 'ABIERTA',
        fechaDeCierre: null,
        horaDeCierre: null,
      }
    });
    // Also we need to clear the cantDeCierre from CierreInsumos related to this caja
    await prisma.aperturaCierreInsumos.updateMany({
      where: { Idcierreyapertura: lastCaja.IDcaja },
      data: {
        cantDeCierre: null
      }
    });
    console.log('Updated last caja to ABIERTA and cleared AperturaCierreInsumos');
  }
}
main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
