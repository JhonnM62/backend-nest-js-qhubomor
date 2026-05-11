import { Module } from '@nestjs/common';
import { PrinterConfigService } from './printer-config.service';
import { PrinterConfigController } from './printer-config.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  providers: [PrinterConfigService],
  controllers: [PrinterConfigController]
})
export class PrinterConfigModule {}
