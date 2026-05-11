const { PrismaClient } = require('./node_modules/@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const personales = await prisma.gastosPersonales.findMany();
  let count = 0;
  for (const g of personales) {
    try {
      await prisma.gastos.create({
        data: {
          IDgastos: g.IDgastos + '-P', // Avoid ID collision
          concepto: g.concepto,
          fechaYHora: g.fechaYHora,
          fecha: g.fecha,
          valor: g.valor,
          fotos: g.fotos,
          medioDePago: g.medioDePago,
          tipo: 'PERSONAL'
        }
      });
      count++;
    } catch (e) {
      console.log('Error inserting', g.IDgastos, e.message);
    }
  }
  console.log(`Migrated ${count} personal expenses.`);
}
main().finally(() => prisma.$disconnect());
