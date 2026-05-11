import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PrinterConfigService {
  constructor(private prisma: PrismaService) {}

  async findAll() {
    return this.prisma.configuracionImpresora.findMany();
  }

  async updateBulk(configs: { estadoOrden: string; imprimir: boolean }[]) {
    // Usamos una transacción para actualizar múltiples estados a la vez
    const results = await this.prisma.$transaction(
      configs.map((config) =>
        this.prisma.configuracionImpresora.upsert({
          where: { estadoOrden: config.estadoOrden },
          update: { imprimir: config.imprimir },
          create: {
            estadoOrden: config.estadoOrden,
            imprimir: config.imprimir,
          },
        })
      )
    );
    return results;
  }
}
