import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PrinterConfigService {
  constructor(private prisma: PrismaService) {}

  async findAll() {
    return this.prisma.configuracionImpresora.findMany();
  }

  async updateBulk(configs: { estadoOrden: string; imprimirComanda: boolean; imprimirFactura: boolean }[]) {
    // Usamos una transacción para actualizar múltiples estados a la vez
    const results = await this.prisma.$transaction(
      configs.map((config) =>
        this.prisma.configuracionImpresora.upsert({
          where: { estadoOrden: config.estadoOrden },
          update: { 
            imprimirComanda: config.imprimirComanda,
            imprimirFactura: config.imprimirFactura
          },
          create: {
            estadoOrden: config.estadoOrden,
            imprimirComanda: config.imprimirComanda,
            imprimirFactura: config.imprimirFactura,
          },
        })
      )
    );
    return results;
  }
}
