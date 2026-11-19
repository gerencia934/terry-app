-- Fase 1c (19-11-2026): historial de cumplimiento de las obligaciones de los permisos ambientales.
-- Antes, «marcar cumplida» solo movía la fecha. Ahora cada cumplimiento queda con su fecha, el radicado ante la
-- autoridad y el soporte, y nadie lo modifica ni lo borra (soporte ante la CAS).
CREATE TABLE "obligacion_cumplimientos" (
  "id"               UUID         NOT NULL DEFAULT gen_random_uuid(),
  "obligacion_id"    UUID         NOT NULL,
  "fecha_programada" DATE,                    -- la fecha que se cumplió (vacía en las obligaciones por evento)
  "cumplida_en"      DATE         NOT NULL,   -- cuándo se cumplió (radicado ante la autoridad)
  "radicado"         VARCHAR(80),
  "soporte_url"      TEXT,
  "nota"             VARCHAR(500),
  "usuario_id"       UUID         NOT NULL,
  "creado_en"        TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT "obligacion_cumplimientos_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "obligacion_cumplimientos_obligacion_id_fkey" FOREIGN KEY ("obligacion_id") REFERENCES "obligaciones_permiso"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "obligacion_cumplimientos_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  -- Algún soporte: el radicado, el enlace al documento o una nota que explique
  CONSTRAINT chk_cumplimiento_soporte CHECK (
    coalesce(char_length(btrim("radicado")), 0) > 0 OR coalesce(char_length(btrim("soporte_url")), 0) > 0 OR coalesce(char_length(btrim("nota")), 0) >= 10
  )
);
CREATE INDEX "ix_cumplimiento_obligacion" ON "obligacion_cumplimientos" ("obligacion_id", "cumplida_en" DESC);

CREATE OR REPLACE FUNCTION fn_cumplimiento_inmutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'El historial de cumplimiento de obligaciones no se modifica ni se borra.';
END $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_cumplimiento_inmutable BEFORE UPDATE OR DELETE ON "obligacion_cumplimientos" FOR EACH ROW EXECUTE FUNCTION fn_cumplimiento_inmutable();
