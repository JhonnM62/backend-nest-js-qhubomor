# syntax=docker/dockerfile:1

# Etapa 0: Base común con OpenSSL (requerido por Prisma en node:20-slim)
FROM node:20-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# Etapa 1: Dependencias (cacheada mientras no cambie package*.json)
FROM base AS deps
COPY package*.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --no-audit --no-fund --prefer-offline

# Etapa 2: Construcción
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY prisma ./prisma/
# Generamos el cliente de Prisma (cacheado si no cambia schema.prisma)
RUN npx prisma generate
COPY . .
RUN npm run build

# Etapa 3: Producción (Imagen final ligera)
FROM base AS runner
ENV NODE_ENV=production

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/prisma ./prisma

# Crear directorios para subidas de archivos
RUN mkdir -p /app/public/uploads/insumos /app/public/uploads/gastos /app/public/uploads/asistencia /app/public/uploads/productos

EXPOSE 3000

# Iniciamos la app con el script de producción
CMD ["npm", "run", "start:prod"]
