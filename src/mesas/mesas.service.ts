import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class MesasService {
  constructor(private prisma: PrismaService) {}

  async findAll() {
    return this.prisma.mesas.findMany({});
  }

  async findOne(id: string) {
    return this.prisma.mesas.findUnique({
      where: { IdMesas: id },
    });
  }
}
