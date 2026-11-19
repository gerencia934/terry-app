-- Fase C de Declaraciones (19-11-2026): deshacer un cargue masivo.
-- Los valores nuevos de los enum van solos en esta migración: PostgreSQL no deja usar un valor en la misma
-- transacción en que se agrega. Las reglas que los usan están en la migración siguiente.
ALTER TYPE "EstadoDeclaracion" ADD VALUE IF NOT EXISTS 'ANULADA';
ALTER TYPE "EstadoCargue" ADD VALUE IF NOT EXISTS 'REVERTIDO';
