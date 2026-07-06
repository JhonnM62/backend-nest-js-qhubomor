import { PrismaClient } from '@prisma/client';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { NominaService } from './src/nomina/nomina.service';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const nominaService = app.get(NominaService);
  const prisma = new PrismaClient();
  
  const usuarios = await prisma.usuarios.findMany();
  
  for (const u of usuarios) {
    if (u.isActive) {
      console.log(`Recalculando para: ${u.nombre}`);
      try {
        const result = await nominaService.recalcularTurnosEmpleado(u.IDusuarios);
        console.log(result);
      } catch (e) {
        console.error('Error:', e.message);
      }
    }
  }
  
  await app.close();
  await prisma.$disconnect();
}

main().catch(console.error);
