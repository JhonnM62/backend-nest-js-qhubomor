# Backend Troubleshooting & Known Issues

This document acts as the AI and Developer Memory for the Q Hubo Mor POS backend. It contains hard-learned lessons from past iterations. **Always consult this file before modifying database logic or file upload pipelines.**

## 1. File Uploads & Static Assets (The 404 Bug)

### The "ENOENT: stat /app/dist/public/index.html" Bug
- **Symptom**: Images upload successfully to the server, but requesting the image URL returns a 404 error. Logs show NestJS trying to find `index.html` inside a `dist/public` folder.
- **Cause 1 (NestJS Static Server)**: Using `__dirname` in `ServeStaticModule` resolves to the compiled `dist/` folder.
- **Cause 2 (Nginx)**: Nginx proxies `/api/v1` to the container. If NestJS serves static files at the root (`/`), Nginx blocks the request.
- **Cause 3 (Multer)**: Using relative paths (`./public/uploads`) in Multer inside a Docker container saves files relative to the execution context, causing mismatches.
- **Fix**: 
  1. Set `serveRoot: '/api/v1'` in `ServeStaticModule`.
  2. Use `process.cwd()` instead of `__dirname` to point to `/app/public`.
  3. In Multer configuration, force absolute paths in production (`/app/public/uploads/...`).

### Heavy Image Payloads
- **Symptom**: The mobile app takes too long to render lists with images.
- **Fix**: Intercept uploads in memory (`storage: memoryStorage()`) and use `sharp` to convert images to `.webp`, resize them (e.g., max 800px width), and reduce quality to 80% before writing to disk.

## 2. Prisma & Database Integrity

### Cascading Delete Crashes
- **Symptom**: Deleting a parent record fails with a Prisma relation error, leaving stock mathematically desynced.
- **Cause**: Typographical errors in the `include: {}` block of the Prisma query (e.g., using `orderinventario` instead of `ordenInventario`). Prisma is strictly case-sensitive regarding relation names defined in `schema.prisma`.
- **Fix**: Always double-check relation names in Prisma schemas before writing cascade logic.

### Raw SQL Sensitivity
- **Symptom**: `this.prisma.$queryRaw` throws syntax errors indicating columns do not exist.
- **Cause**: PostgreSQL maps double-quoted columns with exact case sensitivity.
- **Fix**: When querying the `VENTAS` table via raw SQL, you must use exact quotes: `SELECT "IDventas", "TOTAL INPUT", "Medio de pago" FROM public."VENTAS"`.

### The `class-validator` 400 Bad Request
- **Symptom**: Editing an item from the frontend returns `400 Bad Request: property X should not exist`.
- **Cause**: The frontend spreads the entire database row (including internal IDs or timestamps) into the PUT/PATCH payload. The backend DTO has `whitelist: true` and `forbidNonWhitelisted: true`.
- **Fix**: Either map the payload explicitly on the frontend to match the DTO, or ensure the backend DTO defines all expected incoming fields.

## 3. Deployment Crashes

### "Cannot find module" or Segmentation Faults
- **Symptom**: The Docker container restarts continuously. Logs show Prisma Engine panics or OpenSSL errors.
- **Cause**: Using `node:20-alpine`.
- **Fix**: Switch the Dockerfile base image to `node:20-slim` and run `apt-get install -y openssl`.
