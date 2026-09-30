import { Module, forwardRef } from '@nestjs/common';
import { AppGateway } from './app.gateway';
import { AuthModule } from '../auth/auth.module';
import { ReservasInventarioService } from './reservas.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [forwardRef(() => AuthModule), PrismaModule],
  providers: [AppGateway, ReservasInventarioService],
  exports: [AppGateway, ReservasInventarioService],
})
export class WebsocketModule {}
