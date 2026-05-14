const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log("Connecting to database...");
  const config = await prisma.configuracionNegocio.findUnique({ where: { id: 1 } });
  const cutoff = config ? config.horaCorteDia : '00:00';
  console.log("Cutoff time is:", cutoff);
  const [corteHours, corteMinutes] = cutoff.split(':').map(Number);
  const corteTotalMinutes = (corteHours * 60) + corteMinutes;

  const ventas = await prisma.ventas.findMany();
  console.log(`Found ${ventas.length} ventas.`);
  let updated = 0;
  for (const venta of ventas) {
    if (!venta.fechaYHora) continue;
    
    // Calculate correct fechaContable based on local time
    const localDate = new Date(venta.fechaYHora.getTime() - (5 * 60 * 60 * 1000));
    const currentMinutes = (localDate.getUTCHours() * 60) + localDate.getUTCMinutes();
    
    if (currentMinutes < corteTotalMinutes) {
      localDate.setUTCDate(localDate.getUTCDate() - 1);
    }
    localDate.setUTCHours(0, 0, 0, 0);
    
    // Check if the current fecha is different
    if (!venta.fecha || venta.fecha.getTime() !== localDate.getTime()) {
      console.log(`Updating venta ${venta.pedido || venta.IDventas} from ${venta.fecha} to ${localDate}`);
      await prisma.ventas.update({
        where: { IDventas: venta.IDventas },
        data: { fecha: localDate }
      });
      updated++;
    }
  }
  console.log(`Updated ${updated} ventas`);
}

main().catch(console.error).finally(() => prisma.$disconnect());