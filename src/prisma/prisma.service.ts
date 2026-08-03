import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super({
      datasources: {
        db: {
          url: process.env.DATABASE_URL,
        },
      },
      // Configuración del pool de conexiones:
      // connection_limit: cuántas conexiones simultáneas puede abrir Prisma
      // pool_timeout: segundos de espera antes de lanzar error si no hay conexión libre
      // connect_timeout: segundos máximos para establecer una conexión
    });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
