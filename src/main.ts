import { NestFactory } from '@nestjs/core';
import { json, urlencoded } from 'express';
import { ValidationPipe, Logger } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  const logger = new Logger('Bootstrap');

  const app = await NestFactory.create(AppModule);

  app.enableCors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Bearer'],
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  app.use(json({ limit: '15mb' }));
  app.use(urlencoded({ extended: true, limit: '15mb' }));

  app.setGlobalPrefix('api/v1');

  const config = new DocumentBuilder()
    .setTitle('Q\'hubo Mor POS API')
    .setDescription('API para el sistema de punto de venta del restaurante Q\'hubo Mor')
    .setVersion('1.0')
    .addBearerAuth()
    .addTag('Auth', 'Autenticación y registro de usuarios')
    .addTag('Usuarios', 'Gestión de usuarios del sistema')
    .addTag('Productos', 'Gestión de productos del menú')
    .addTag('Categorias', 'Gestión de categorías de productos')
    .addTag('Ventas', 'Gestión de ventas y órdenes')
    .addTag('Caja', 'Gestión de caja (apertura y cierre)')
    .addTag('Inventario', 'Gestión de inventario')
    .addTag('Clientes', 'Gestión de clientes')
    .addTag('Proveedores', 'Gestión de proveedores')
    .addTag('Gastos', 'Gestión de gastos')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  const port = process.env.PORT || 3000;
  await app.listen(port, '0.0.0.0');
  logger.log(`Application is running on: http://0.0.0.0:${port}`);
  logger.log(`Swagger documentation: http://0.0.0.0:${port}/api/docs`);
}

bootstrap();
