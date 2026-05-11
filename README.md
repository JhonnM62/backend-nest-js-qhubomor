# Q'hubo Mor POS Backend

API RESTful para el sistema de punto de venta del restaurante Q'hubo Mor.

## Stack Tecnológico

- **Framework:** NestJS (TypeScript)
- **Base de Datos:** PostgreSQL con Prisma ORM
- **Caché:** Redis (Cache Manager)
- **Autenticación:** JWT con Passport
- **Documentación:** Swagger/OpenAPI
- **Tiempo Real:** WebSocket (Socket.io)

## Requisitos

- Node.js 18+
- PostgreSQL 14+
- Redis (opcional para caché)

## Instalación

```bash
# Instalar dependencias
npm install

# Generar cliente Prisma
npx prisma generate

# Aplicar migraciones (base de datos existente)
npx prisma migrate deploy
```

## Configuración

Crear archivo `.env` con las variables de entorno:

```env
DATABASE_URL="postgresql://postgres:password@host:port/database"
JWT_SECRET=your_secret_key
JWT_EXPIRATION=24h
REDIS_HOST=localhost
REDIS_PORT=6379
PORT=3000
```

## Ejecutar

```bash
# Desarrollo
npm run start:dev

# Producción
npm run start
```

## Endpoints

### Autenticación (Públicos)

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| POST | `/api/v1/auth/register` | Registrar usuario |
| POST | `/api/v1/auth/login` | Iniciar sesión |

### Productos

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| GET | `/api/v1/productos` | Listar productos (paginación) |
| GET | `/api/v1/productos/:id` | Obtener producto |
| POST | `/api/v1/productos` | Crear producto |
| PATCH | `/api/v1/productos/:id` | Actualizar producto |
| DELETE | `/api/v1/productos/:id` | Eliminar producto |

### Categorías

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| GET | `/api/v1/categorias` | Listar categorías (con caché) |
| GET | `/api/v1/categorias/:id` | Obtener categoría |
| POST | `/api/v1/categorias` | Crear categoría |
| PATCH | `/api/v1/categorias/:id` | Actualizar categoría |
| DELETE | `/api/v1/categorias/:id` | Eliminar categoría |

### Ventas

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| GET | `/api/v1/ventas` | Listar ventas (paginación) |
| GET | `/api/v1/ventas/hoy` | Ventas del día |
| GET | `/api/v1/ventas/mesa/:mesaId` | Ventas por mesa |
| GET | `/api/v1/ventas/:id` | Obtener venta |
| POST | `/api/v1/ventas` | Crear venta |
| POST | `/api/v1/ventas/completa` | Crear venta con productos |
| PATCH | `/api/v1/ventas/:id/estado` | Actualizar estado |

### Caja

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| GET | `/api/v1/caja` | Listar cajas |
| GET | `/api/v1/caja/activa` | Caja activa |
| GET | `/api/v1/caja/:id` | Obtener caja |
| GET | `/api/v1/caja/resumen/:id` | Resumen de caja |
| POST | `/api/v1/caja/abrir` | Abrir caja |
| PATCH | `/api/v1/caja/cerrar/:id` | Cerrar caja |

### Inventario

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| GET | `/api/v1/inventario` | Listar inventarios |
| GET | `/api/v1/inventario/bajo` | Items con stock bajo |
| GET | `/api/v1/inventario/:id` | Obtener inventario |
| POST | `/api/v1/inventario` | Crear inventario |
| POST | `/api/v1/inventario/item` | Agregar item |
| PATCH | `/api/v1/inventario/item/:id/comprar` | Marcar como comprado |
| DELETE | `/api/v1/inventario/:id` | Eliminar inventario |

### Clientes

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| GET | `/api/v1/clientes` | Listar clientes |
| GET | `/api/v1/clientes/:id` | Obtener cliente |
| POST | `/api/v1/clientes` | Crear cliente |
| PATCH | `/api/v1/clientes/:id` | Actualizar cliente |
| DELETE | `/api/v1/clientes/:id` | Eliminar cliente |

### Proveedores

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| GET | `/api/v1/proveedores` | Listar proveedores |
| GET | `/api/v1/proveedores/:id` | Obtener proveedor |
| POST | `/api/v1/proveedores` | Crear proveedor |
| PATCH | `/api/v1/proveedores/:id` | Actualizar proveedor |
| DELETE | `/api/v1/proveedores/:id` | Eliminar proveedor |

### Gastos

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| GET | `/api/v1/gastos` | Listar gastos |
| GET | `/api/v1/gastos/total` | Total de gastos |
| GET | `/api/v1/gastos/personales` | Gastos personales |
| GET | `/api/v1/gastos/:id` | Obtener gasto |
| POST | `/api/v1/gastos` | Crear gasto |
| POST | `/api/v1/gastos/personales` | Crear gasto personal |
| PATCH | `/api/v1/gastos/:id` | Actualizar gasto |
| DELETE | `/api/v1/gastos/:id` | Eliminar gasto |

### Usuarios

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| GET | `/api/v1/usuarios` | Listar usuarios |
| GET | `/api/v1/usuarios/:id` | Obtener usuario |
| POST | `/api/v1/usuarios` | Crear usuario |
| PATCH | `/api/v1/usuarios/:id` | Actualizar usuario |
| DELETE | `/api/v1/usuarios/:id` | Eliminar usuario (soft delete) |

## Formato de Respuesta

### Éxito

```json
{
  "success": true,
  "data": { ... },
  "meta": {
    "timestamp": "2026-04-23T12:00:00.000Z",
    "path": "/api/v1/productos"
  }
}
```

### Lista Paginada

```json
{
  "success": true,
  "data": [ ... ],
  "meta": {
    "total": 100,
    "page": 1,
    "limit": 20,
    "totalPages": 5,
    "hasNextPage": true,
    "hasPreviousPage": false
  }
}
```

### Error

```json
{
  "success": false,
  "error": {
    "code": "NOT_FOUND",
    "message": "Producto no encontrado",
    "statusCode": 404,
    "timestamp": "2026-04-23T12:00:00.000Z",
    "path": "/api/v1/productos/123"
  }
}
```

## WebSocket

Endpoint: `ws://localhost:3000/pos`

Eventos disponibles:

- `joinKitchen` - Unirse a la sala de cocina
- `joinCaja` - Unirse a la sala de caja
- `nuevaOrden` - Nueva orden creada
- `ordenActualizada` - Estado de orden actualizado
- `ordenCompletada` - Orden completada

## Swagger

Documentación interactiva disponible en: `http://localhost:3000/api/docs`

## Docker

```bash
# Construir imagen
docker build -t qhubomor-api .

# Ejecutar con docker-compose
docker-compose up -d
```

## Tests

```bash
# Unit tests
npm run test

# E2E tests
npm run test:e2e
```

## Licencia

MIT
