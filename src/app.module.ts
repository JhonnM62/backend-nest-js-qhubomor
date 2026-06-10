import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR, APP_FILTER } from '@nestjs/core';
import { AppConfigModule } from './config/config.module';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { UsuariosModule } from './auth/users/usuarios.module';
import { ProductosModule } from './productos/productos.module';
import { CategoriasModule } from './categorias/categorias.module';
import { VentasModule } from './ventas/ventas.module';
import { InventarioModule } from './inventario/inventario.module';
import { InsumosModule } from './insumos/insumos.module';
import { ClientesModule } from './clientes/clientes.module';
import { ProveedoresModule } from './proveedores/proveedores.module';
import { CajaModule } from './caja/caja.module';
import { GastosModule } from './gastos/gastos.module';
import { MesasModule } from './mesas/mesas.module';
import { ComentariosModule } from './comentarios/comentarios.module';
import { WebsocketModule } from './websocket/websocket.module';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { CacheModule } from '@nestjs/cache-manager';
import { PrinterConfigModule } from './printer-config/printer-config.module';
import { EstadisticasModule } from './estadisticas/estadisticas.module';
import { ReportesModule } from './reportes/reportes.module';
import { NotificationsModule } from './notifications/notifications.module';
import { ConfiguracionModule } from './configuracion/configuracion.module';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';
import { AiModule } from './ai/ai.module'; // IMPORT AI MODULE
import { CategoriasInsumosModule } from './categorias-insumos/categorias-insumos.module';
import { CargosModule } from './cargos/cargos.module';
import { NominaModule } from './nomina/nomina.module';
@Module({
  imports: [
    AppConfigModule,
    ServeStaticModule.forRoot({
      rootPath: join(process.cwd(), 'public'),
      serveRoot: '/api/v1',
      serveStaticOptions: {
        fallthrough: false, // Evita buscar index.html y devuelve 404 directo si no existe el archivo
      },
    }),
    CacheModule.register({
      isGlobal: true,
      ttl: 60000,
    }),
    ThrottlerModule.forRoot([
      {
        name: 'short',
        ttl: 60000,
        limit: 100,
      },
      {
        name: 'long',
        ttl: 600000,
        limit: 1000,
      },
    ]),
    PrismaModule,
    AuthModule,
    UsuariosModule,
    ProductosModule,
    CategoriasModule,
    VentasModule,
    InventarioModule,
    InsumosModule,
    ClientesModule,
    ProveedoresModule,
    CajaModule,
    GastosModule,
    MesasModule,
    ComentariosModule,
    WebsocketModule,
    PrinterConfigModule,
    EstadisticasModule,
    ReportesModule,
    NotificationsModule,
    ConfiguracionModule,
    AiModule, // ADD TO IMPORTS
    CategoriasInsumosModule,
    CargosModule,
    NominaModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
