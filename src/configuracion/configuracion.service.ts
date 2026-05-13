import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ConfiguracionService {
  constructor(private prisma: PrismaService) {}

  async getConfiguracion() {
    let config = await this.prisma.configuracionNegocio.findUnique({
      where: { id: 1 }
    });

    if (!config) {
      config = await this.prisma.configuracionNegocio.create({
        data: {
          id: 1,
          horaCorteDia: '00:00'
        }
      });
    }

    return config;
  }

  async updateConfiguracion(horaCorteDia: string) {
    return this.prisma.configuracionNegocio.upsert({
      where: { id: 1 },
      update: { horaCorteDia },
      create: {
        id: 1,
        horaCorteDia
      }
    });
  }
}
