-- Add duracionDescansoMinutos to CARGOS_EMPLEADO
ALTER TABLE "CARGOS_EMPLEADO" ADD COLUMN "DuracionDescansoMinutos" INTEGER NOT NULL DEFAULT 0;

-- Add inicioDescanso and finDescanso to TURNOS
ALTER TABLE "TURNOS" ADD COLUMN "InicioDescanso" TIMESTAMP(3);
ALTER TABLE "TURNOS" ADD COLUMN "FinDescanso" TIMESTAMP(3);
