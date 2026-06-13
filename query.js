const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
prisma.aperturaCierreCaja.findMany({
  where: { OR: [{valorFaltante: {gt:0}}, {valorExcedente: {gt:0}}], fechaDeCierre: { gte: new Date('2026-06-01'), lte: new Date('2026-06-30') } },
  select: { fechaDeCierre: true, fechaDeApertura: true, valorFaltante: true, valorExcedente: true },
  orderBy: { fechaDeCierre: 'asc' }
}).then(console.log).finally(() => prisma.$disconnect());
