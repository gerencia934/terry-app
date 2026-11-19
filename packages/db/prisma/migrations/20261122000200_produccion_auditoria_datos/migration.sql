-- =====================================================================
-- Requisitos de producción (docs/REQUISITOS_PRODUCCION.md §3 y §5; revisión en docs/REVISION_REQUISITOS_PRODUCCION.md)
--   1) Auditoría con IP y navegador, que no se puede modificar ni borrar (conservación de 10 años)
--   2) Aceptación de la política de tratamiento de datos personales en el primer ingreso (Ley 1581 de 2012)
-- =====================================================================

-- 1) Auditoría ------------------------------------------------------------
ALTER TABLE auditoria ADD COLUMN ip VARCHAR(64), ADD COLUMN agente VARCHAR(300);
CREATE INDEX ix_auditoria_fecha ON auditoria (fecha);
CREATE INDEX ix_auditoria_usuario ON auditoria (usuario_id, fecha);

CREATE OR REPLACE FUNCTION fn_auditoria_inmutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'La auditoría no se modifica ni se borra';
END $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_auditoria_inmutable BEFORE UPDATE OR DELETE ON auditoria
  FOR EACH ROW EXECUTE FUNCTION fn_auditoria_inmutable();

-- 2) Política de datos personales -------------------------------------------
-- Se registra la versión aceptada, cuándo y desde qué IP. Si la política cambia de versión, se pide aceptarla otra vez.
ALTER TABLE usuarios
  ADD COLUMN datos_politica_version VARCHAR(20),
  ADD COLUMN datos_aceptados_en TIMESTAMPTZ,
  ADD COLUMN datos_aceptados_ip VARCHAR(64);
