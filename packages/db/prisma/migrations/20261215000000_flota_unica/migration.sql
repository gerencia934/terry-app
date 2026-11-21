-- Flota única: los vehículos propios se sincronizan desde Mantenimiento (docs/ECOSISTEMA.md).
ALTER TABLE "vehiculos" ADD COLUMN "mto_sincronizado_en" TIMESTAMPTZ;
ALTER TABLE "vehiculos" ADD COLUMN "mto_estado" VARCHAR(20);
ALTER TABLE "vehiculos" ADD COLUMN "mto_apto" BOOLEAN;
