-- Reglas de negocio que se aplican en la base de datos (después de la migración Prisma).

-- 1) Conciliación: diferencia calculada + justificación obligatoria si supera ±2 %
ALTER TABLE conciliacion_items
  ADD COLUMN diferencia NUMERIC(12,2) GENERATED ALWAYS AS (cantidad_destino - cantidad_origen) STORED,
  ADD COLUMN diferencia_pct NUMERIC(7,2) GENERATED ALWAYS AS
      (CASE WHEN cantidad_origen = 0 THEN NULL
            ELSE ROUND((cantidad_destino - cantidad_origen) * 100 / cantidad_origen, 2) END) STORED,
  ADD CONSTRAINT chk_justificacion_diferencia CHECK (
      cantidad_origen = 0
      OR ABS((cantidad_destino - cantidad_origen) * 100 / cantidad_origen) <= 2
      OR COALESCE(LENGTH(TRIM(justificacion)), 0) > 0);

-- 2) Una ruta no puede iniciar el recorrido (estados intermedios) si el preoperacional
--    del vehículo para ese día no está aprobado (Res. 40595/2022 – PESV).
CREATE OR REPLACE FUNCTION fn_bloqueo_preoperacional() RETURNS trigger AS $$
DECLARE orden_estado INT; final_estado BOOLEAN;
BEGIN
  SELECT orden, es_final INTO orden_estado, final_estado FROM estados_recorrido WHERE id = NEW.estado_recorrido_id;
  -- Los estados finales (Finalizado, Cancelado) no se bloquean: cancelar siempre debe ser posible.
  IF orden_estado IS NOT NULL AND orden_estado > 1 AND NOT final_estado AND NOT EXISTS (
       SELECT 1 FROM preoperacionales p
        WHERE p.vehiculo_id = NEW.vehiculo_id
          AND p.fecha_programada = NEW.fecha_programada
          AND p.aprobado IS TRUE) THEN
    RAISE EXCEPTION 'La ruta % no puede salir: preoperacional del vehículo sin aprobar', NEW.codigo;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_bloqueo_preoperacional
  BEFORE UPDATE OF estado_recorrido_id ON rutas
  FOR EACH ROW EXECUTE FUNCTION fn_bloqueo_preoperacional();

-- 3) Una solicitud solo puede incluir declaraciones AUTORIZADAS
CREATE OR REPLACE FUNCTION fn_item_declaracion_autorizada() RETURNS trigger AS $$
BEGIN
  IF (SELECT estado FROM declaraciones WHERE id = NEW.declaracion_id) <> 'AUTORIZADA' THEN
    RAISE EXCEPTION 'La declaración no está autorizada; no se puede programar su recolección';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_item_declaracion_autorizada
  BEFORE INSERT OR UPDATE OF declaracion_id ON solicitud_items
  FOR EACH ROW EXECUTE FUNCTION fn_item_declaracion_autorizada();
