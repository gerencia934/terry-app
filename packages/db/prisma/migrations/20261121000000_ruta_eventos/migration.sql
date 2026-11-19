-- =====================================================================
-- TERRY-GO · Fase 3-B — Historial de etapas de la ruta.
-- Permite aceptar puntos GPS que llegan tarde (celular sin señal): el punto vale si a la HORA
-- DEL PUNTO la ruta estaba en una etapa con rastreo, aunque llegue cuando ya cambió de etapa.
-- =====================================================================

CREATE TABLE "ruta_eventos" (
    "id" BIGSERIAL NOT NULL,
    "ruta_id" UUID NOT NULL,
    "estado_recorrido_id" UUID,
    "desde" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ruta_eventos_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ruta_eventos_ruta_id_desde_idx" ON "ruta_eventos"("ruta_id", "desde");

ALTER TABLE "ruta_eventos" ADD CONSTRAINT "ruta_eventos_ruta_id_fkey" FOREIGN KEY ("ruta_id") REFERENCES "rutas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ruta_eventos" ADD CONSTRAINT "ruta_eventos_estado_recorrido_id_fkey" FOREIGN KEY ("estado_recorrido_id") REFERENCES "estados_recorrido"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Conversión: cada ruta existente arranca su historial con su etapa actual
INSERT INTO ruta_eventos (ruta_id, estado_recorrido_id, desde)
SELECT id, estado_recorrido_id, COALESCE(hora_salida, fecha_programada::timestamptz) FROM rutas;

-- La base anota cada cambio de etapa
CREATE OR REPLACE FUNCTION fn_ruta_evento() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.estado_recorrido_id IS DISTINCT FROM OLD.estado_recorrido_id THEN
    INSERT INTO ruta_eventos (ruta_id, estado_recorrido_id) VALUES (NEW.id, NEW.estado_recorrido_id);
  END IF;
  RETURN NULL;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_ruta_evento AFTER INSERT OR UPDATE OF estado_recorrido_id ON rutas
  FOR EACH ROW EXECUTE FUNCTION fn_ruta_evento();

-- GPS: vale si a la hora del punto la ruta estaba en una etapa con rastreo (reemplaza la versión de 3-A).
-- No se aceptan puntos con hora futura (reloj del teléfono adelantado más de 10 minutos).
CREATE OR REPLACE FUNCTION fn_rastreo_permitido() RETURNS trigger AS $$
DECLARE con_rastreo BOOLEAN;
BEGIN
  IF NEW.registrado_en > now() + INTERVAL '10 minutes' THEN
    RAISE EXCEPTION 'La hora del punto GPS está en el futuro: revise el reloj del teléfono';
  END IF;
  SELECT e.rastreo INTO con_rastreo
    FROM ruta_eventos ev JOIN estados_recorrido e ON e.id = ev.estado_recorrido_id
   WHERE ev.ruta_id = NEW.ruta_id AND ev.desde <= NEW.registrado_en
   ORDER BY ev.desde DESC, ev.id DESC LIMIT 1;
  IF NOT COALESCE(con_rastreo, false) THEN
    RAISE EXCEPTION 'La ruta no estaba en una etapa con rastreo a esa hora: no se registra la ubicación';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
