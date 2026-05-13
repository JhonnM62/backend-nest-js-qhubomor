const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  const ventas = await prisma.ventas.findMany({
    where: { estado: { in: ['PAGADO', 'ENTREGADO'] } },
    include: { ordenVentas: true },
    orderBy: { fechaYHora: 'desc' },
    take: 10
  });
  console.log(JSON.stringify(ventas.map(v => v.ordenVentas.map(ov => ov.comentarios)), null, 2));
}
main().catch(console.error).finally(() => prisma.$disconnect());