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

  // --- CONFIGURACION IA ---
  async getConfiguracionIA() {
    let configIA = await this.prisma.configuracionIA.findUnique({
      where: { id: 1 }
    });

    if (!configIA) {
      configIA = await this.prisma.configuracionIA.create({
        data: {
          id: 1,
          modeloDefecto: 'gemini-1.5-flash',
          temperatura: 0.4,
          topP: 0.95,
          maxTokens: 2048,
          isActive: true
        }
      });
    }

    return configIA;
  }

  async updateConfiguracionIA(data: {
    apiKey?: string;
    modeloDefecto?: string;
    temperatura?: number;
    topP?: number;
    maxTokens?: number;
    isActive?: boolean;
  }) {
    return this.prisma.configuracionIA.upsert({
      where: { id: 1 },
      update: data,
      create: {
        id: 1,
        ...data,
      }
    });
  }
}
