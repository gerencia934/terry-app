-- =====================================================================
-- Documentos reales de la operación (19-11-2026) — recepción, manifiestos y certificados
-- Ver docs/referencia/ANALISIS_DOCUMENTOS_REALES.md (§1–§3) y docs/REQUISITOS_PRODUCCION.md (§3).
--   1) Numeración propia: manifiestos TV#### (sin reinicio anual), certificados PSAP{año}-{n}
--   2) Facturación por contrato (valor 0 sin que fallen conciliación ni prefactura)
--   3) Transportador externo con NIT; firma del receptor de Terra Viva en la descarga
--   4) Configuración de la empresa (ciudad de firma, representante, certificaciones, nota de báscula)
--   5) Certificados por generador (clientes GESTOR) y hash SHA-256 del PDF
--   6) Textos legales del certificado, con versión, que solo salen si aplica su disposición
--   7) Nada legal se borra: al anular un manifiesto su conciliación queda ANULADA
-- =====================================================================

-- 1) Numeración ----------------------------------------------------------
-- Además corrige el relleno: lpad recortaba los números más largos que los dígitos (100000 con 5 dígitos → «10000»).
CREATE OR REPLACE FUNCTION fn_siguiente_consecutivo(p_empresa UUID, p_documento TEXT) RETURNS TEXT AS $$
DECLARE c consecutivos; anio_actual INT := EXTRACT(YEAR FROM (now() AT TIME ZONE 'America/Bogota'))::INT; n TEXT;
BEGIN
  INSERT INTO consecutivos (empresa_id, documento, prefijo, digitos, reinicio_anual, anio)
  VALUES (p_empresa, p_documento,
          CASE p_documento WHEN 'MANIFIESTO' THEN 'TV' WHEN 'INSPECCION' THEN 'INS-' WHEN 'ACTA' THEN 'PSAP' ELSE '' END,
          CASE p_documento WHEN 'MANIFIESTO' THEN 4 WHEN 'ACTA' THEN 0 ELSE 5 END,
          p_documento <> 'MANIFIESTO', anio_actual)
  ON CONFLICT (empresa_id, documento) DO NOTHING;
  -- La fila queda bloqueada hasta el fin de la transacción: no hay números repetidos ni saltos por concurrencia.
  UPDATE consecutivos
     SET ultimo = CASE WHEN reinicio_anual AND anio <> anio_actual THEN 1 ELSE ultimo + 1 END,
         anio = CASE WHEN reinicio_anual THEN anio_actual ELSE anio END
   WHERE empresa_id = p_empresa AND documento = p_documento
  RETURNING * INTO c;
  n := c.ultimo::TEXT;
  IF c.digitos > length(n) THEN n := lpad(n, c.digitos, '0'); END IF;
  RETURN c.prefijo || CASE WHEN c.reinicio_anual THEN c.anio || '-' ELSE '' END || n;
END $$ LANGUAGE plpgsql;

-- Las bases que ya numeraban con MF-/ACT- siguen su conteo con el formato nuevo.
-- Para continuar la serie del sistema anterior (p. ej. TV1830), se ajusta «último» desde Ajustes › Datos de la empresa.
UPDATE consecutivos SET prefijo = 'TV', digitos = 4, reinicio_anual = false WHERE documento = 'MANIFIESTO' AND prefijo = 'MF-';
UPDATE consecutivos SET prefijo = 'PSAP', digitos = 0 WHERE documento = 'ACTA' AND prefijo = 'ACT-';

-- 2) Facturación por contrato ----------------------------------------------
ALTER TYPE "TipoNegociacion" ADD VALUE IF NOT EXISTS 'CONTRATO';

-- 3) Transportador externo y firma del receptor --------------------------------
ALTER TABLE transportes_terceros ADD COLUMN nit VARCHAR(15);
ALTER TABLE manifiestos
  ADD COLUMN receptor_id UUID REFERENCES usuarios(id),
  ADD COLUMN receptor_nombre VARCHAR(150),
  ADD COLUMN receptor_documento VARCHAR(20),
  ADD COLUMN firma_receptor_url TEXT;
-- En una descarga en planta firman el receptor de Terra Viva y el conductor o el cliente.
ALTER TABLE manifiestos ADD CONSTRAINT chk_mf_descargue_receptor
  CHECK (tipo <> 'DESCARGUE' OR estado <> 'REALIZADO' OR (firma_receptor_url IS NOT NULL AND receptor_nombre IS NOT NULL)) NOT VALID;

-- 4) Configuración de la empresa -------------------------------------------
ALTER TABLE empresas ADD COLUMN configuracion JSONB NOT NULL DEFAULT '{}';

-- 5) Certificados por generador y hash ---------------------------------------
ALTER TABLE actas
  ADD COLUMN generador_nit VARCHAR(15),
  ADD COLUMN generador_nombre VARCHAR(200),
  ADD COLUMN pdf_sha256 CHAR(64);

-- 6) Textos legales del certificado --------------------------------------------
-- Cada código tiene versiones; solo una activa. Las anteriores se conservan: el certificado guarda la versión que usó.
CREATE TABLE textos_legales (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id    UUID NOT NULL REFERENCES empresas(id),
  codigo        VARCHAR(30) NOT NULL,
  version       INT NOT NULL,
  titulo        VARCHAR(150) NOT NULL,
  texto         TEXT NOT NULL,
  disposiciones VARCHAR(20)[] NOT NULL DEFAULT '{}', -- códigos de disposición; vacío = va en todos los certificados
  orden         SMALLINT NOT NULL DEFAULT 0,
  vigente_desde DATE NOT NULL DEFAULT CURRENT_DATE,
  activo        BOOLEAN NOT NULL DEFAULT true,
  revisado      BOOLEAN NOT NULL DEFAULT false, -- texto inicial pendiente de revisión jurídica
  creado_por    UUID REFERENCES usuarios(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (empresa_id, codigo, version)
);
CREATE UNIQUE INDEX ux_texto_legal_activo ON textos_legales (empresa_id, codigo) WHERE activo;

-- 7) Anular en vez de borrar ---------------------------------------------------
ALTER TYPE "EstadoConciliacion" ADD VALUE IF NOT EXISTS 'ANULADA';

CREATE OR REPLACE FUNCTION fn_conciliacion_transicion() RETURNS trigger AS $$
DECLARE mf RECORD; incompletas INT;
BEGIN
  IF NEW.estado = OLD.estado THEN RETURN NEW; END IF;
  SELECT numero, estado INTO mf FROM manifiestos WHERE id = NEW.manifiesto_id;
  IF OLD.estado::TEXT = 'ANULADA' THEN RAISE EXCEPTION 'La conciliación del manifiesto % está anulada', mf.numero; END IF;
  IF NEW.estado::TEXT = 'ANULADA' THEN
    IF mf.estado <> 'ANULADO' THEN RAISE EXCEPTION 'La conciliación se anula solo al anular el manifiesto %', mf.numero; END IF;
    RETURN NEW;
  END IF;
  IF NEW.estado = 'APROBADA' THEN
    IF mf.estado <> 'REALIZADO' THEN RAISE EXCEPTION 'El manifiesto % no está grabado', mf.numero; END IF;
    -- Facturación por contrato o sin costo: la línea no necesita precio (documentos reales, manifiestos en $0)
    SELECT count(*) INTO incompletas FROM conciliacion_items
     WHERE conciliacion_id = NEW.id
       AND (cantidad_destino IS NULL OR (precio_unitario IS NULL AND COALESCE(tipo_negociacion::TEXT, '') NOT IN ('CONTRATO', 'SIN_COSTO')));
    IF incompletas > 0 THEN
      RAISE EXCEPTION 'Conciliación del manifiesto %: % línea(s) sin cantidad conciliada o sin precio', mf.numero, incompletas;
    END IF;
    NEW.aprobada_en := now();
  ELSE -- volver a borrador
    IF EXISTS (SELECT 1 FROM conciliacion_items ci JOIN actas a ON a.id = ci.acta_id
                WHERE ci.conciliacion_id = NEW.id AND a.estado = 'EMITIDA') THEN
      RAISE EXCEPTION 'Conciliación del manifiesto %: ya está certificada en un acta emitida', mf.numero;
    END IF;
    NEW.aprobada_en := NULL; NEW.aprobada_por := NULL;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

-- Una conciliación anulada ya no se modifica (sus líneas quedan como estaban, para el historial).
CREATE OR REPLACE FUNCTION fn_conciliacion_anulada_fija() RETURNS trigger AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM conciliaciones WHERE id = COALESCE(NEW.conciliacion_id, OLD.conciliacion_id) AND estado::TEXT = 'ANULADA') THEN
    RAISE EXCEPTION 'La conciliación está anulada: no se modifica';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_conciliacion_anulada_fija BEFORE INSERT OR UPDATE OR DELETE ON conciliacion_items
  FOR EACH ROW EXECUTE FUNCTION fn_conciliacion_anulada_fija();

-- Efectos de grabar y de anular: igual que antes (solicitudes automáticas agrupadas por sede y fecha), pero al anular
-- la conciliación queda ANULADA y las solicitudes recurrentes que nadie tocó quedan «no aprobadas», sin borrarse.
CREATE OR REPLACE FUNCTION fn_manifiesto_efectos() RETURNS trigger AS $$
DECLARE conc UUID; g RECORD; sol UUID;
BEGIN
  IF NEW.estado = OLD.estado THEN RETURN NULL; END IF;

  IF NEW.estado = 'REALIZADO' THEN
    -- a) las líneas de solicitud recogidas quedan realizadas, con la cantidad del manifiesto
    UPDATE solicitud_items si SET estado = 'REALIZADO', cantidad_real = mi.cantidad_origen
      FROM manifiesto_items mi WHERE mi.manifiesto_id = NEW.id AND si.id = mi.solicitud_item_id;
    -- b) se abre la conciliación en borrador con la cantidad cargada, el precio y la negociación del cliente
    INSERT INTO conciliaciones (id, empresa_id, manifiesto_id) VALUES (gen_random_uuid(), NEW.empresa_id, NEW.id)
      RETURNING id INTO conc;
    INSERT INTO conciliacion_items (id, conciliacion_id, manifiesto_item_id, cantidad_origen, metrica_id, precio_unitario,
                                    tipo_negociacion, forma_pago, disposicion_id, orden_compra)
    SELECT gen_random_uuid(), conc, mi.id, mi.cantidad_origen, mi.metrica_id, mi.precio_unitario,
           cl.tipo_negociacion, cl.forma_pago, mi.disposicion_id, NEW.orden_compra
      FROM manifiesto_items mi JOIN clientes cl ON cl.id = NEW.cliente_id
     WHERE mi.manifiesto_id = NEW.id;
    -- c) solicitudes recurrentes (clase PRE): una por sede y fecha
    FOR g IN SELECT mi.sucursal_id, NEW.fecha_servicio + d.frecuencia_dias AS fecha, min(d.frecuencia_dias) AS frecuencia
               FROM manifiesto_items mi JOIN declaraciones d ON d.id = mi.declaracion_id
              WHERE mi.manifiesto_id = NEW.id AND NEW.tipo = 'CARGUE'
                AND d.solicitud_automatica AND d.frecuencia_dias IS NOT NULL AND d.estado = 'AUTORIZADA' AND d.activa
                AND EXISTS (SELECT 1 FROM declaracion_sucursales ds WHERE ds.declaracion_id = d.id AND ds.sucursal_id = mi.sucursal_id AND ds.activa)
              GROUP BY mi.sucursal_id, NEW.fecha_servicio + d.frecuencia_dias
              ORDER BY 2, 1
    LOOP
      INSERT INTO solicitudes (id, empresa_id, clase, operacion, cliente_id, fecha_solicitada, fecha_activacion, manifiesto_origen_id, creado_por)
      VALUES (gen_random_uuid(), NEW.empresa_id, 'PRE', 'CARGA', NEW.cliente_id, g.fecha, g.fecha - LEAST(3, g.frecuencia), NEW.id, NEW.realizado_por)
      RETURNING id INTO sol;
      INSERT INTO solicitud_items (id, solicitud_id, declaracion_id, sucursal_id, cantidad_estimada)
      SELECT DISTINCT ON (d.id) gen_random_uuid(), sol, d.id, mi.sucursal_id, d.cantidad_frecuencia
        FROM manifiesto_items mi JOIN declaraciones d ON d.id = mi.declaracion_id
       WHERE mi.manifiesto_id = NEW.id AND mi.sucursal_id = g.sucursal_id AND NEW.fecha_servicio + d.frecuencia_dias = g.fecha
         AND d.solicitud_automatica AND d.estado = 'AUTORIZADA' AND d.activa
         AND EXISTS (SELECT 1 FROM declaracion_sucursales ds WHERE ds.declaracion_id = d.id AND ds.sucursal_id = mi.sucursal_id AND ds.activa)
       ORDER BY d.id, mi.id;
    END LOOP;

  ELSIF NEW.estado = 'ANULADO' THEN
    -- a) la conciliación (en borrador: la aprobada impide anular) queda anulada, con sus líneas como estaban
    UPDATE conciliaciones SET estado = 'ANULADA' WHERE manifiesto_id = NEW.id AND estado = 'BORRADOR';
    -- b) las líneas de solicitud vuelven a pendientes y se libera su programación
    UPDATE ruta_items ri SET liberado = true
      FROM manifiesto_items mi WHERE mi.manifiesto_id = NEW.id AND ri.solicitud_item_id = mi.solicitud_item_id AND NOT ri.liberado;
    UPDATE solicitud_items si SET estado = 'PENDIENTE', cantidad_real = NULL
      FROM manifiesto_items mi WHERE mi.manifiesto_id = NEW.id AND si.id = mi.solicitud_item_id AND si.estado IN ('REALIZADO', 'PROGRAMADO');
    -- c) las solicitudes recurrentes que nacieron de él y nadie tocó quedan «no aprobadas» (se conservan)
    UPDATE solicitudes SET aprobacion = 'NO_APROBADA', observaciones = concat_ws(' · ', observaciones, 'Retirada: se anuló el manifiesto ' || NEW.numero)
     WHERE manifiesto_origen_id = NEW.id AND clase = 'PRE' AND aprobacion = 'PENDIENTE' AND estado = 'PENDIENTE';
  END IF;
  RETURN NULL;
END $$ LANGUAGE plpgsql;
