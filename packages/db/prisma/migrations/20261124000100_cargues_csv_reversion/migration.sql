-- Fase C de Declaraciones (19-11-2026): cargue desde CSV y deshacer un lote.
-- «Nada legal se borra»: deshacer un cargue no borra sus declaraciones. Las deja ANULADAS (inactivas, como
-- constancia) y libera su código interno para volver a cargar el archivo corregido.

-- 1. Formato del archivo: Excel (.xlsx), o CSV con su separador.
ALTER TABLE cargues_masivos
  ADD CONSTRAINT chk_cargue_formato CHECK (
    (formato = 'XLSX' AND delimitador IS NULL)
    OR (formato = 'CSV' AND delimitador IS NOT NULL AND delimitador IN (',', ';', '|', E'\t')) -- sin IS NOT NULL, un NULL pasaría el CHECK
  );

-- 2. Lote deshecho: quién, cuándo y por qué. Después no cambia más.
ALTER TABLE cargues_masivos
  ADD COLUMN revertido_en TIMESTAMPTZ,
  ADD COLUMN revertido_por UUID REFERENCES usuarios(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD COLUMN motivo_reversion VARCHAR(300),
  ADD CONSTRAINT chk_cargue_revertido CHECK (
    (estado = 'REVERTIDO') = (revertido_en IS NOT NULL)
    AND (estado <> 'REVERTIDO' OR (revertido_por IS NOT NULL AND coalesce(char_length(btrim(motivo_reversion)), 0) >= 10))
  );

CREATE OR REPLACE FUNCTION fn_cargue_revertido() RETURNS trigger AS $$
BEGIN
  IF OLD.estado = 'REVERTIDO' THEN
    RAISE EXCEPTION 'El cargue «%» ya se deshizo: no se modifica.', OLD.archivo;
  END IF;
  IF NEW.estado = 'REVERTIDO' THEN
    IF OLD.estado <> 'CONFIRMADO' THEN
      RAISE EXCEPTION 'Solo se deshace un cargue confirmado («%» está %).', OLD.archivo, OLD.estado;
    END IF;
    IF OLD.tipo_cargue IS DISTINCT FROM 'DECLARACIONES' THEN
      RAISE EXCEPTION 'Solo se deshacen cargues de declaraciones: «%» se corrige con otro cargue o en su pantalla.', OLD.archivo;
    END IF;
    -- Sus declaraciones se anulan antes, en la misma transacción
    IF EXISTS (SELECT 1 FROM declaraciones WHERE cargue_id = NEW.id AND estado <> 'ANULADA') THEN
      RAISE EXCEPTION 'Para deshacer el cargue «%» primero se anulan todas sus declaraciones.', OLD.archivo;
    END IF;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_cargue_revertido BEFORE UPDATE ON cargues_masivos FOR EACH ROW EXECUTE FUNCTION fn_cargue_revertido();

-- 3. Declaración anulada: sin uso en la operación y sin cambios posteriores (ni en sus sedes, disposiciones, precios,
--    riesgos o etiquetado). Queda inactiva: chk_decl_activa_autorizada ya exige que solo una autorizada esté activa.

CREATE OR REPLACE FUNCTION fn_decl_anulada() RETURNS trigger AS $$
BEGIN
  IF OLD.estado = 'ANULADA' THEN
    RAISE EXCEPTION 'La declaración N.° % está anulada (se deshizo el cargue que la creó): no se modifica. Cree una nueva.', OLD.numero;
  END IF;
  IF NEW.estado = 'ANULADA' AND (
       EXISTS (SELECT 1 FROM solicitud_items WHERE declaracion_id = NEW.id)
    OR EXISTS (SELECT 1 FROM manifiesto_items WHERE declaracion_id = NEW.id)) THEN
    RAISE EXCEPTION 'La declaración N.° % ya tiene solicitudes o manifiestos: no se puede anular. Inactívela desde su ficha.', NEW.numero;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_decl_anulada BEFORE UPDATE ON declaraciones FOR EACH ROW EXECUTE FUNCTION fn_decl_anulada();

CREATE OR REPLACE FUNCTION fn_hijo_decl_anulada() RETURNS trigger AS $$
DECLARE v_numero INT;
BEGIN
  SELECT numero INTO v_numero FROM declaraciones
   WHERE id = CASE WHEN TG_OP = 'DELETE' THEN OLD.declaracion_id ELSE NEW.declaracion_id END AND estado = 'ANULADA';
  IF FOUND THEN
    RAISE EXCEPTION 'La declaración N.° % está anulada: no se modifica. Cree una nueva.', v_numero;
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_tarifa_decl_anulada BEFORE INSERT OR UPDATE OR DELETE ON tarifas FOR EACH ROW EXECUTE FUNCTION fn_hijo_decl_anulada();
CREATE TRIGGER trg_sede_decl_anulada BEFORE INSERT OR UPDATE OR DELETE ON declaracion_sucursales FOR EACH ROW EXECUTE FUNCTION fn_hijo_decl_anulada();
CREATE TRIGGER trg_disposicion_decl_anulada BEFORE INSERT OR UPDATE OR DELETE ON declaracion_disposiciones FOR EACH ROW EXECUTE FUNCTION fn_hijo_decl_anulada();
CREATE TRIGGER trg_riesgo_decl_anulada BEFORE INSERT OR UPDATE OR DELETE ON declaracion_riesgos FOR EACH ROW EXECUTE FUNCTION fn_hijo_decl_anulada();
CREATE TRIGGER trg_etiquetado_decl_anulada BEFORE INSERT OR UPDATE OR DELETE ON declaracion_etiquetados FOR EACH ROW EXECUTE FUNCTION fn_hijo_decl_anulada();

-- 4. El código interno no se repite entre las declaraciones vigentes de un cliente: el de una anulada queda libre.
DROP INDEX IF EXISTS "declaraciones_cliente_id_codigo_interno_key";
CREATE UNIQUE INDEX ux_decl_codigo_interno ON declaraciones (cliente_id, codigo_interno) WHERE estado <> 'ANULADA';
