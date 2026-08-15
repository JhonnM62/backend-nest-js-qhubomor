/*
  Warnings:
  - You are about to alter the column `Cantidad` on the `Recetainsumos` table. The data in that column could be lost. The data in that column will be cast from `Integer` to `Decimal(10,2)`.
*/
-- AlterTable
ALTER TABLE "Recetainsumos" ALTER COLUMN "Cantidad" TYPE DECIMAL(10, 2);
