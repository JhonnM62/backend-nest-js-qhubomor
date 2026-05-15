# Backend Architecture - Q Hubo Mor POS

## Overview
The backend is a monolithic REST API built with NestJS, serving as the core engine for the Q Hubo Mor POS system. It handles complex inventory mathematics, sales processing, role-based access control, and real-time state broadcasting.

## Tech Stack
- **Framework**: NestJS (TypeScript)
- **Database**: PostgreSQL
- **ORM**: Prisma Client
- **Real-time**: Socket.io (NestJS WebSockets)
- **Authentication**: JWT (JSON Web Tokens)
- **Image Processing**: Multer + Sharp (WebP conversion)

## Directory Structure
```text
src/
├── auth/                 # JWT Strategies, Auth Controller, and User CRUD
├── caja/                 # Cash register flow (Apertura, Cierre, Arqueo Congelado)
├── categorias/           # Product and Insumo categories
├── clientes/             # Customer management
├── comentarios/          # Product modifiers (Pricing logic)
├── common/               # Global Guards (RBAC), Decorators, Interceptors
├── estadisticas/         # Dashboard metrics and charting data
├── gastos/               # Expense tracking with receipt image uploads
├── insumos/              # Raw materials and stock management
├── inventario/           # Bulk operations and mathematical stock rollbacks
├── mesas/                # Restaurant table tracking
├── orders/               # (Legacy/Ventas crossover)
├── productos/            # Final products mapped to Insumos
├── reportes/             # 'Dinero Guardado' pre-calculations
├── ventas/               # POS Transactions and state tracking
└── websocket/            # AppGateway for global Socket.io broadcasts
```

## Key Business Logic Flows

### 1. Insumos (Inventory) Mathematics
The system maintains a strict separation between historical entry totals and current availability.
- **Table**: `INSUMOS`
- **Columns**: `Cantidad` (Int) tracks total historical additions. `Disponible` (Decimal) tracks the current physical stock.
- **Rule**: When making sales, the backend decrements `Disponible`. When reverting/deleting a sale, it increments `Disponible`.

### 2. Comentarios (Modifiers) Pricing
In `ventas.service.ts`, "Comentarios" are not just text; they are priced modifiers.
- **Formula**: The total price of a product in a sale is `(Quantity * Unit Price) + Sum(Modifiers Prices)`.
- **Impact**: This calculated total flows directly into the `Caja` (Cash Register) mathematical summaries.

### 3. Caja (Cash Register) Freeze State
To allow simultaneous audits across devices without closing the register:
- **Flow**: The frontend sends a `PATCH /caja/:id` request (not a close request).
- **Sync**: The backend emits a `refreshCaja` socket event. Other devices silently update their `horaCongelada` UI without losing the data currently typed in their forms.

### 4. Real-time Broadcasting
Every state-mutating request (POST, PUT, PATCH, DELETE) on critical entities must notify connected clients.
- **Implementation**: Services inject `AppGateway` and call `this.appGateway.server.emit('eventName')`.
- **Key Events**: `ordenActualizada`, `refreshInsumos`, `refreshCaja`, `refreshGastos`.
