import { Module, forwardRef } from '@nestjs/common';
import { AppGateway } from './app.gateway';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [forwardRef(() => AuthModule)],
  providers: [AppGateway],
  exports: [AppGateway],
})
export class WebsocketModule {}
