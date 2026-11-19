-- =====================================================================
-- Respuestas de la gerencia del 19-11-2026 (docs/PREGUNTAS_GERENCIA.md; el detalle con soportes queda fuera del
-- repositorio público). Cambian el diseño de cumplimiento:
--   1. La Res. DGL 000632 de 2023 ampara ARD y ARnD SIN características de peligrosidad (art. 6): ningún residuo
--      peligroso se autoriza con tratamiento en Los Pinos, y Los Pinos no recibe ni almacena RESPEL.
--   2. Los gestores aliados se registran con su licencia, autoridad, vigencia (o vigencia indefinida) y exclusiones;
--      una disposición puede tener varios aliados (celda de seguridad: Veolia SI y CGS).
--   3. Borras y lodos con hidrocarburos solo van a biorremediación con caracterización CRETIB negativa; los RCD con
--      hidrocarburos no se reciben.
--   4. Obligaciones reales con su código del Cronograma Maestro (OB-xx), artículo y periodicidad.
--   5. Textos legales que salen solo si el certificado tiene residuos peligrosos.
--   6. Certificado del aliado por línea: sin su número no se emite el certificado final de esas líneas.
--   7. Cambios críticos a una declaración autorizada la devuelven a revisión y la autoriza otra persona.
-- Nada se borra: las disposiciones sin acto que las ampare quedan inactivas.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Disposiciones: qué admiten
-- ---------------------------------------------------------------------
ALTER TABLE disposiciones
  ADD COLUMN admite_peligrosos BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN hidrocarburos VARCHAR(20) NOT NULL DEFAULT 'ADMITE'
    CONSTRAINT chk_disp_hidrocarburos CHECK (hidrocarburos IN ('ADMITE', 'CON_CARACTERIZACION', 'NO_ADMITE'));

-- Tratamientos propios en Los Pinos: solo residuos sin características de peligrosidad
UPDATE disposiciones SET admite_peligrosos = false WHERE codigo IN ('ASP', 'BIO', 'RCD', 'ACU');
UPDATE disposiciones SET hidrocarburos = 'CON_CARACTERIZACION' WHERE codigo = 'BIO';
UPDATE disposiciones SET hidrocarburos = 'NO_ADMITE' WHERE codigo = 'RCD';
-- Sin acto que las ampare (aprovechamiento propio, lavado y reúso, coprocesamiento) o mal definidas
-- («incineración y celda ordinaria» se separa en incineración y relleno sanitario): quedan inactivas
UPDATE disposiciones SET activo = false, requiere_permiso = true,
       soporte_legal = 'Sin acto que la ampare: inactiva por decisión de la gerencia (19-11-2026)'
 WHERE codigo IN ('APR', 'REC', 'LAV', 'COP', 'INCO');

-- ---------------------------------------------------------------------
-- 2) Gestores aliados: varios por disposición, licencia con vigencia o indefinida, exclusiones
-- ---------------------------------------------------------------------
CREATE TABLE disposicion_gestores (
  disposicion_id UUID NOT NULL REFERENCES disposiciones(id) ON DELETE CASCADE ON UPDATE CASCADE,
  proveedor_id   UUID NOT NULL REFERENCES proveedores(id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT disposicion_gestores_pkey PRIMARY KEY (disposicion_id, proveedor_id)
);
CREATE INDEX ix_disposicion_gestor_proveedor ON disposicion_gestores (proveedor_id);
INSERT INTO disposicion_gestores (disposicion_id, proveedor_id)
SELECT id, proveedor_id FROM disposiciones WHERE proveedor_id IS NOT NULL ON CONFLICT DO NOTHING;
ALTER TABLE disposiciones DROP COLUMN proveedor_id;

ALTER TABLE proveedores
  ALTER COLUMN licencia TYPE VARCHAR(300),
  ADD COLUMN licencia_autoridad VARCHAR(80),
  ADD COLUMN licencia_indefinida BOOLEAN NOT NULL DEFAULT false, -- el acto no fija término (vida útil del proyecto)
  ADD COLUMN licencia_url TEXT,
  ADD COLUMN alcance TEXT, -- qué residuos acepta y cuáles excluye
  ADD COLUMN excluye_tipos_residuo VARCHAR(20)[] NOT NULL DEFAULT '{}', -- códigos de tipos_residuo (p. ej. HOSP)
  ADD COLUMN soporte_comercial VARCHAR(200),
  ADD COLUMN soporte_comercial_fecha DATE,
  ADD CONSTRAINT chk_prov_licencia_indefinida CHECK (NOT licencia_indefinida OR licencia_vence IS NULL);

-- ---------------------------------------------------------------------
-- 3) Declaraciones: hidrocarburos, caracterización y revisión por otra persona
-- ---------------------------------------------------------------------
ALTER TABLE declaraciones
  ADD COLUMN contiene_hidrocarburos BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN caracterizacion_url TEXT, -- caracterización de peligrosidad (CRETIB) del laboratorio
  ADD COLUMN revision_pedida_por UUID REFERENCES usuarios(id) ON DELETE SET NULL ON UPDATE CASCADE,
  -- Quien hizo el cambio crítico no puede autorizarla (control de cuatro ojos)
  ADD CONSTRAINT chk_decl_cuatro_ojos CHECK (estado <> 'AUTORIZADA' OR revision_pedida_por IS NULL OR aprobada_por IS DISTINCT FROM revision_pedida_por);

-- ---------------------------------------------------------------------
-- 4) Cobertura legal
--    · aliado: licencia registrada y vigente (fecha o indefinida); basta un aliado de la disposición
--    · por declaración: además, un peligroso nunca con tratamiento propio en Los Pinos, el aliado no debe excluir
--      el tipo de residuo, y las reglas de hidrocarburos
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_aliado_vigente(p_proveedor UUID) RETURNS BOOLEAN AS $$
  SELECT COALESCE(LENGTH(TRIM(pr.licencia)), 0) > 0 AND (pr.licencia_indefinida OR pr.licencia_vence >= CURRENT_DATE)
  FROM proveedores pr WHERE pr.id = p_proveedor;
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION fn_disposicion_cubierta(p_disposicion UUID, p_empresa UUID) RETURNS BOOLEAN AS $$
  SELECT CASE
    WHEN NOT d.requiere_permiso THEN TRUE
    WHEN NOT d.propia THEN EXISTS (
         SELECT 1 FROM disposicion_gestores dg WHERE dg.disposicion_id = d.id AND COALESCE(fn_aliado_vigente(dg.proveedor_id), FALSE))
    ELSE EXISTS (
         SELECT 1 FROM permiso_disposiciones pd
           JOIN permisos_ambientales p ON p.id = pd.permiso_id
          WHERE pd.disposicion_id = d.id
            AND p.empresa_id = p_empresa
            AND p.estado IN ('VIGENTE', 'POR_VENCER')
            AND (p.vence IS NULL OR p.vence >= CURRENT_DATE))
  END
  FROM disposiciones d WHERE d.id = p_disposicion AND d.activo;
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION fn_decl_autorizacion_check(p_id UUID) RETURNS VOID AS $$
DECLARE d RECORD; sin_cobertura TEXT; no_admite TEXT; tipo_res TEXT; excluida TEXT;
BEGIN
  SELECT * INTO d FROM declaraciones WHERE id = p_id;
  IF NOT FOUND OR d.estado <> 'AUTORIZADA' THEN RETURN; END IF;
  IF NOT EXISTS (SELECT 1 FROM declaracion_sucursales WHERE declaracion_id = d.id) THEN
    RAISE EXCEPTION 'Declaración %: asigne al menos una sede antes de autorizar', d.numero;
  END IF;
  IF d.tipo = 'RESIDUO' AND NOT EXISTS (SELECT 1 FROM declaracion_disposiciones WHERE declaracion_id = d.id) THEN
    RAISE EXCEPTION 'Declaración %: indique la disposición o manejo antes de autorizar', d.numero;
  END IF;
  SELECT string_agg(x.nombre, ', ') INTO sin_cobertura
    FROM declaracion_disposiciones dd JOIN disposiciones x ON x.id = dd.disposicion_id
   WHERE dd.declaracion_id = d.id AND NOT COALESCE(fn_disposicion_cubierta(dd.disposicion_id, d.empresa_id), FALSE);
  IF sin_cobertura IS NOT NULL THEN
    RAISE EXCEPTION 'Declaración %: ningún permiso o licencia vigente cubre: %', d.numero, sin_cobertura;
  END IF;
  -- Res. DGL 000632 de 2023, art. 6: los tratamientos de Los Pinos solo admiten residuos sin características de peligrosidad
  IF d.es_peligroso THEN
    SELECT string_agg(x.nombre, ', ') INTO no_admite
      FROM declaracion_disposiciones dd JOIN disposiciones x ON x.id = dd.disposicion_id
     WHERE dd.declaracion_id = d.id AND NOT x.admite_peligrosos;
    IF no_admite IS NOT NULL THEN
      RAISE EXCEPTION 'Declaración %: es un residuo peligroso y % solo admite residuos sin características de peligrosidad (Res. DGL 000632 de 2023, art. 6). Mientras no exista la licencia ambiental, los peligrosos van directo a un gestor aliado', d.numero, no_admite;
    END IF;
  END IF;
  -- Hidrocarburos: RCD no los admite; biorremediación solo con caracterización CRETIB negativa cargada
  IF d.contiene_hidrocarburos THEN
    SELECT string_agg(x.nombre, ', ') INTO no_admite
      FROM declaracion_disposiciones dd JOIN disposiciones x ON x.id = dd.disposicion_id
     WHERE dd.declaracion_id = d.id AND (x.hidrocarburos = 'NO_ADMITE'
        OR (x.hidrocarburos = 'CON_CARACTERIZACION' AND COALESCE(LENGTH(TRIM(d.caracterizacion_url)), 0) = 0));
    IF no_admite IS NOT NULL THEN
      RAISE EXCEPTION 'Declaración %: el residuo contiene hidrocarburos y % no lo admite sin una caracterización de peligrosidad (CRETIB) negativa cargada (los RCD con hidrocarburos no se reciben)', d.numero, no_admite;
    END IF;
  END IF;
  -- Exclusiones del aliado (p. ej., la celda de Las Bateas no recibe hospitalarios): al menos un aliado vigente que lo acepte
  SELECT tr.codigo INTO tipo_res FROM tipos_residuo tr WHERE tr.id = d.tipo_residuo_id;
  IF tipo_res IS NOT NULL THEN
    SELECT string_agg(x.nombre, ', ') INTO excluida
      FROM declaracion_disposiciones dd JOIN disposiciones x ON x.id = dd.disposicion_id
     WHERE dd.declaracion_id = d.id AND NOT x.propia AND x.requiere_permiso
       AND NOT EXISTS (SELECT 1 FROM disposicion_gestores dg JOIN proveedores pr ON pr.id = dg.proveedor_id
                        WHERE dg.disposicion_id = x.id AND COALESCE(fn_aliado_vigente(pr.id), FALSE)
                          AND NOT (tipo_res = ANY (pr.excluye_tipos_residuo)));
    IF excluida IS NOT NULL THEN
      RAISE EXCEPTION 'Declaración %: ningún gestor aliado vigente de % recibe este tipo de residuo', d.numero, excluida;
    END IF;
  END IF;
END $$ LANGUAGE plpgsql;

-- Las reglas también se revisan si cambian la peligrosidad, los hidrocarburos o la caracterización de una autorizada
DROP TRIGGER IF EXISTS trg_decl_autorizacion ON declaraciones;
CREATE CONSTRAINT TRIGGER trg_decl_autorizacion
  AFTER INSERT OR UPDATE OF estado, es_peligroso, contiene_hidrocarburos, caracterizacion_url, tipo_residuo_id ON declaraciones
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION fn_decl_autorizacion_desde_decl();

-- ---------------------------------------------------------------------
-- 5) Los Pinos no recibe ni almacena residuos peligrosos (Res. 000632, art. 6): ni recepción en planta ni
--    recolección con destino Los Pinos. Los peligrosos van directo al gestor aliado.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_item_peligroso_destino() RETURNS trigger AS $$
DECLARE propio BOOLEAN; peligroso BOOLEAN; num TEXT;
BEGIN
  SELECT pr.es_propio, m.numero INTO propio, num FROM manifiestos m JOIN proveedores pr ON pr.id = m.destino_id WHERE m.id = NEW.manifiesto_id;
  SELECT es_peligroso INTO peligroso FROM declaraciones WHERE id = NEW.declaracion_id;
  IF propio AND peligroso THEN
    RAISE EXCEPTION 'Manifiesto %: Los Pinos no puede recibir ni almacenar residuos peligrosos (Res. DGL 000632 de 2023, art. 6). Llévelos directo al gestor aliado', num;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_item_peligroso_destino BEFORE INSERT OR UPDATE OF declaracion_id ON manifiesto_items
  FOR EACH ROW EXECUTE FUNCTION fn_item_peligroso_destino();

-- La celda temporal de RESPEL en Los Pinos no está habilitada (licencia en trámite, Exp. CAS 210.40.00113.2026)
UPDATE bodegas SET nombre = 'PSA Los Pinos · Celda temporal RESPEL (no habilitada: requiere licencia)'
 WHERE nombre = 'PSA Los Pinos · Celda temporal RESPEL';

-- ---------------------------------------------------------------------
-- 6) Permisos: nombres y fechas según los actos (el Auto del plan de contingencia es 0244-20, no 0244-21)
-- ---------------------------------------------------------------------
UPDATE permisos_ambientales SET acto = 'Auto SAA No. 0244-20', expedicion = '2020-09-29'
 WHERE acto = 'Auto SAA No. 0244-21';
UPDATE permisos_ambientales SET acto = 'Oficio SAA No. 0311/21', expedicion = '2021-04-19'
 WHERE acto = 'Oficio SAA No. 0311-21';
UPDATE permisos_ambientales SET acto = 'Resolución SAO No. 00235-24'
 WHERE acto = 'Resolución 0235-2024';
-- Las obligaciones de ejemplo (sembradas con «VERIFICAR») se reemplazan por las reales al sembrar
DELETE FROM obligaciones_permiso WHERE descripcion LIKE '%(VERIFICAR fecha y periodicidad en el acto)';

ALTER TABLE obligaciones_permiso
  ALTER COLUMN proxima_fecha DROP NOT NULL, -- las permanentes y por evento no tienen fecha
  ALTER COLUMN periodicidad TYPE VARCHAR(120),
  ADD COLUMN codigo VARCHAR(10), -- ID del Cronograma Maestro de Cumplimiento (OB-xx)
  ADD COLUMN articulo VARCHAR(120),
  ADD COLUMN meses SMALLINT; -- al marcarla cumplida, la próxima fecha avanza estos meses (vacío = no se repite sola)

-- ---------------------------------------------------------------------
-- 7) Textos legales: algunos salen solo si el certificado tiene residuos peligrosos
-- ---------------------------------------------------------------------
ALTER TABLE textos_legales ADD COLUMN solo_peligrosos BOOLEAN NOT NULL DEFAULT false;

-- ---------------------------------------------------------------------
-- 8) Certificado del gestor aliado por línea (texto GESTOR_ALIADO): sin él no se emite el certificado final
-- ---------------------------------------------------------------------
ALTER TABLE conciliacion_items ADD COLUMN certificado_aliado VARCHAR(60);
