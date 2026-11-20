-- Módulo Comercial (reemplaza a Bigin; requisitos de producción 7.3):
-- - prospectos (empresas que pueden volverse clientes) con sus contactos;
-- - oportunidades por etapas, con actividades y seguimiento (llamadas, visitas, tareas con fecha);
-- - cotizaciones en PDF con número consecutivo (COT-AAAA-NNNN) y código de verificación;
-- - al ganar una oportunidad se crean el cliente, su sede y las declaraciones con su tarifa, sin volver a digitar;
-- - los prospectos también llegan del formulario del sitio web y de la importación de Bigin (sin duplicar).
-- Nada se borra: una oportunidad se marca perdida con su motivo; una cotización enviada no se cambia.

CREATE TYPE "OrigenProspecto" AS ENUM ('WEB', 'BIGIN', 'REFERIDO', 'LLAMADA', 'VISITA', 'EVENTO', 'OTRO');
CREATE TYPE "EtapaOportunidad" AS ENUM ('NUEVA', 'CONTACTADA', 'COTIZADA', 'NEGOCIACION', 'GANADA', 'PERDIDA');
CREATE TYPE "TipoActividad" AS ENUM ('LLAMADA', 'VISITA', 'CORREO', 'REUNION', 'WHATSAPP', 'TAREA', 'NOTA');
CREATE TYPE "EstadoCotizacion" AS ENUM ('BORRADOR', 'ENVIADA', 'ACEPTADA', 'RECHAZADA');

-- 1) Prospectos y contactos
CREATE TABLE prospectos (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id          UUID NOT NULL REFERENCES empresas(id),
  razon_social        VARCHAR(200) NOT NULL,
  nit                 VARCHAR(10), -- sin DV; puede conocerse después
  sector              VARCHAR(60),
  municipio_dane      CHAR(5) REFERENCES municipios(codigo_dane),
  direccion           VARCHAR(300),
  telefono            VARCHAR(30),
  correo              VARCHAR(150),
  sitio_web           VARCHAR(200),
  representante_legal VARCHAR(150),
  origen              "OrigenProspecto" NOT NULL DEFAULT 'OTRO',
  asesor_id           UUID REFERENCES usuarios(id),
  cliente_id          UUID REFERENCES clientes(id), -- ya es cliente (al ganar o porque se abrió desde un cliente)
  notas               TEXT,
  activo              BOOLEAN NOT NULL DEFAULT true,
  bigin_id            VARCHAR(60), -- id del registro en Bigin: volver a importar no duplica
  creado_por          UUID REFERENCES usuarios(id),
  creado_en           TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_en      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_prospecto_nit CHECK (nit IS NULL OR nit ~ '^[0-9]{6,10}$'),
  CONSTRAINT chk_prospecto_nombre CHECK (length(btrim(razon_social)) >= 2)
);
CREATE UNIQUE INDEX ux_prospectos_nit ON prospectos (empresa_id, nit) WHERE nit IS NOT NULL;
CREATE UNIQUE INDEX ux_prospectos_cliente ON prospectos (cliente_id) WHERE cliente_id IS NOT NULL;
CREATE UNIQUE INDEX ux_prospectos_bigin ON prospectos (empresa_id, bigin_id) WHERE bigin_id IS NOT NULL;
CREATE INDEX ix_prospectos_empresa ON prospectos (empresa_id, creado_en DESC);

CREATE TABLE contactos_comerciales (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prospecto_id UUID NOT NULL REFERENCES prospectos(id),
  nombre       VARCHAR(150) NOT NULL,
  cargo        VARCHAR(100),
  telefono     VARCHAR(30),
  correo       VARCHAR(150),
  principal    BOOLEAN NOT NULL DEFAULT false,
  activo       BOOLEAN NOT NULL DEFAULT true,
  bigin_id     VARCHAR(60),
  creado_en    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_contacto_nombre CHECK (length(btrim(nombre)) >= 2)
);
CREATE UNIQUE INDEX ux_contacto_principal ON contactos_comerciales (prospecto_id) WHERE principal AND activo;
CREATE UNIQUE INDEX ux_contactos_bigin ON contactos_comerciales (prospecto_id, bigin_id) WHERE bigin_id IS NOT NULL;
CREATE INDEX ix_contactos_prospecto ON contactos_comerciales (prospecto_id);

-- 2) Oportunidades por etapas
CREATE TABLE oportunidades (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id      UUID NOT NULL REFERENCES empresas(id),
  prospecto_id    UUID NOT NULL REFERENCES prospectos(id),
  contacto_id     UUID REFERENCES contactos_comerciales(id),
  titulo          VARCHAR(200) NOT NULL,
  etapa           "EtapaOportunidad" NOT NULL DEFAULT 'NUEVA',
  valor_mensual   NUMERIC(16,2), -- lo que se espera facturar al mes (COP)
  cierre_estimado DATE,
  asesor_id       UUID REFERENCES usuarios(id),
  motivo_perdida  VARCHAR(300),
  cerrada_en      TIMESTAMPTZ,
  cerrada_por     UUID REFERENCES usuarios(id),
  cliente_id      UUID REFERENCES clientes(id), -- el cliente que se creó (o se amplió) al ganarla
  notas           TEXT,
  bigin_id        VARCHAR(60),
  creado_por      UUID REFERENCES usuarios(id),
  creado_en       TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_en  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_op_titulo CHECK (length(btrim(titulo)) >= 2),
  CONSTRAINT chk_op_valor CHECK (valor_mensual IS NULL OR valor_mensual >= 0),
  CONSTRAINT chk_op_cerrada CHECK ((etapa IN ('GANADA', 'PERDIDA')) = (cerrada_en IS NOT NULL)),
  CONSTRAINT chk_op_perdida CHECK (etapa <> 'PERDIDA' OR length(btrim(COALESCE(motivo_perdida, ''))) >= 3),
  -- Ganada: con su cliente (las ganadas que vienen del historial de Bigin pueden no tenerlo)
  CONSTRAINT chk_op_ganada CHECK (etapa <> 'GANADA' OR cliente_id IS NOT NULL OR bigin_id IS NOT NULL)
);
CREATE UNIQUE INDEX ux_oportunidades_bigin ON oportunidades (empresa_id, bigin_id) WHERE bigin_id IS NOT NULL;
CREATE INDEX ix_oportunidades_etapa ON oportunidades (empresa_id, etapa);
CREATE INDEX ix_oportunidades_prospecto ON oportunidades (prospecto_id);

CREATE OR REPLACE FUNCTION fn_oportunidad_reglas() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Las oportunidades no se borran: se marcan perdidas con su motivo';
  END IF;
  IF OLD.etapa = 'GANADA' AND (NEW.etapa <> 'GANADA' OR NEW.cliente_id IS DISTINCT FROM OLD.cliente_id) THEN
    RAISE EXCEPTION 'La oportunidad ya se ganó y creó el cliente: no se reabre (abra una nueva)';
  END IF;
  NEW.actualizado_en := now();
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_oportunidad_reglas BEFORE UPDATE OR DELETE ON oportunidades FOR EACH ROW EXECUTE FUNCTION fn_oportunidad_reglas();

-- 3) Actividades y seguimiento: historia (no se borra). Una tarea pendiente tiene fecha y aún no está hecha.
CREATE TABLE actividades_comerciales (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id     UUID NOT NULL REFERENCES empresas(id),
  prospecto_id   UUID NOT NULL REFERENCES prospectos(id),
  oportunidad_id UUID REFERENCES oportunidades(id),
  tipo           "TipoActividad" NOT NULL,
  asunto         VARCHAR(200) NOT NULL,
  detalle        TEXT,
  vence_en       TIMESTAMPTZ,
  hecha_en       TIMESTAMPTZ,
  responsable_id UUID REFERENCES usuarios(id),
  creado_por     UUID REFERENCES usuarios(id),
  creado_en      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_act_asunto CHECK (length(btrim(asunto)) >= 2),
  CONSTRAINT chk_act_fecha CHECK (vence_en IS NOT NULL OR hecha_en IS NOT NULL)
);
CREATE INDEX ix_actividades_pendientes ON actividades_comerciales (empresa_id, vence_en) WHERE hecha_en IS NULL;
CREATE INDEX ix_actividades_prospecto ON actividades_comerciales (prospecto_id, creado_en DESC);

CREATE OR REPLACE FUNCTION fn_actividad_comercial_sin_borrar() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Las actividades comerciales son la historia del cliente: no se borran';
END $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_actividad_comercial_sin_borrar BEFORE DELETE ON actividades_comerciales FOR EACH ROW EXECUTE FUNCTION fn_actividad_comercial_sin_borrar();

-- 4) Cotizaciones: el número se asigna al enviarla (los borradores no gastan número). Enviada, es el documento que
--    recibió el cliente: no cambia; solo se registra su respuesta (aceptada o rechazada) una vez.
CREATE TABLE cotizaciones (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id          UUID NOT NULL REFERENCES empresas(id),
  oportunidad_id      UUID NOT NULL REFERENCES oportunidades(id),
  numero              VARCHAR(20),
  estado              "EstadoCotizacion" NOT NULL DEFAULT 'BORRADOR',
  validez_dias        INTEGER NOT NULL DEFAULT 30,
  tipo_negociacion    "TipoNegociacion" NOT NULL DEFAULT 'COBRO',
  forma_pago          "FormaPago" NOT NULL DEFAULT 'CONTADO',
  condiciones         TEXT,
  total_estimado      NUMERIC(16,2) NOT NULL DEFAULT 0,
  contenido           JSONB, -- copia fija de lo enviado: el PDF se puede rehacer igual
  pdf_clave           VARCHAR(300),
  pdf_sha256          CHAR(64),
  codigo_verificacion CHAR(24) UNIQUE,
  enviada_en          TIMESTAMPTZ,
  enviada_por         UUID REFERENCES usuarios(id),
  respondida_en       TIMESTAMPTZ,
  motivo_rechazo      VARCHAR(300),
  creado_por          UUID REFERENCES usuarios(id),
  creado_en           TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_cot_validez CHECK (validez_dias BETWEEN 1 AND 365),
  CONSTRAINT chk_cot_total CHECK (total_estimado >= 0),
  CONSTRAINT chk_cot_enviada CHECK (estado = 'BORRADOR'
    OR (numero IS NOT NULL AND enviada_en IS NOT NULL AND pdf_clave IS NOT NULL AND contenido IS NOT NULL AND codigo_verificacion IS NOT NULL)),
  CONSTRAINT chk_cot_respuesta CHECK ((estado IN ('ACEPTADA', 'RECHAZADA')) = (respondida_en IS NOT NULL))
);
CREATE UNIQUE INDEX ux_cotizaciones_numero ON cotizaciones (empresa_id, numero) WHERE numero IS NOT NULL;
CREATE INDEX ix_cotizaciones_oportunidad ON cotizaciones (oportunidad_id);

CREATE OR REPLACE FUNCTION fn_cotizacion_reglas() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Las cotizaciones no se borran';
  END IF;
  IF OLD.estado <> 'BORRADOR' THEN
    IF NEW.numero IS DISTINCT FROM OLD.numero OR NEW.oportunidad_id <> OLD.oportunidad_id OR NEW.empresa_id <> OLD.empresa_id
       OR NEW.validez_dias <> OLD.validez_dias OR NEW.tipo_negociacion <> OLD.tipo_negociacion OR NEW.forma_pago <> OLD.forma_pago
       OR NEW.condiciones IS DISTINCT FROM OLD.condiciones OR NEW.total_estimado <> OLD.total_estimado
       OR NEW.contenido IS DISTINCT FROM OLD.contenido OR NEW.pdf_clave IS DISTINCT FROM OLD.pdf_clave OR NEW.pdf_sha256 IS DISTINCT FROM OLD.pdf_sha256
       OR NEW.codigo_verificacion IS DISTINCT FROM OLD.codigo_verificacion OR NEW.enviada_en IS DISTINCT FROM OLD.enviada_en THEN
      RAISE EXCEPTION 'La cotización ya se envió: no se cambia (haga una nueva)';
    END IF;
    IF NEW.estado = 'BORRADOR' OR (OLD.estado IN ('ACEPTADA', 'RECHAZADA') AND NEW.estado IS DISTINCT FROM OLD.estado) THEN
      RAISE EXCEPTION 'La cotización ya tiene la respuesta del cliente: no se cambia';
    END IF;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_cotizacion_reglas BEFORE UPDATE OR DELETE ON cotizaciones FOR EACH ROW EXECUTE FUNCTION fn_cotizacion_reglas();

CREATE TABLE cotizacion_items (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cotizacion_id     UUID NOT NULL REFERENCES cotizaciones(id),
  orden             SMALLINT NOT NULL,
  tipo              "TipoDeclaracion" NOT NULL,
  catalogo_id       UUID REFERENCES catalogo_residuos(id), -- servicio del catálogo
  descripcion       VARCHAR(300) NOT NULL,
  categoria_id      UUID REFERENCES categorias_declarado(id),
  linea_servicio_id UUID REFERENCES lineas_servicio(id),
  disposicion_id    UUID REFERENCES disposiciones(id), -- tratamiento o disposición propuesta
  es_peligroso      BOOLEAN NOT NULL DEFAULT false,
  metrica_id        UUID REFERENCES metricas(id), -- unidad del precio; NULL = precio global por servicio
  cantidad_estimada NUMERIC(12,2),
  frecuencia        VARCHAR(60), -- «mensual», «cada 15 días»…
  precio_unitario   NUMERIC(14,2) NOT NULL,
  CONSTRAINT chk_citem_descripcion CHECK (length(btrim(descripcion)) >= 2),
  CONSTRAINT chk_citem_precio CHECK (precio_unitario >= 0),
  CONSTRAINT chk_citem_cantidad CHECK (cantidad_estimada IS NULL OR cantidad_estimada > 0),
  CONSTRAINT ux_citem_orden UNIQUE (cotizacion_id, orden)
);

CREATE OR REPLACE FUNCTION fn_cotizacion_item_reglas() RETURNS trigger AS $$
DECLARE c_id UUID; est "EstadoCotizacion";
BEGIN
  IF TG_OP = 'DELETE' THEN c_id := OLD.cotizacion_id; ELSE c_id := NEW.cotizacion_id; END IF;
  SELECT estado INTO est FROM cotizaciones WHERE id = c_id;
  IF est IS DISTINCT FROM 'BORRADOR' OR (TG_OP = 'UPDATE' AND NEW.cotizacion_id <> OLD.cotizacion_id) THEN
    RAISE EXCEPTION 'La cotización ya se envió: sus renglones no cambian (haga una nueva)';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_cotizacion_item_reglas BEFORE INSERT OR UPDATE OR DELETE ON cotizacion_items FOR EACH ROW EXECUTE FUNCTION fn_cotizacion_item_reglas();

-- 5) Consecutivo de las cotizaciones: COT-2026-0001 (reinicia cada año). Igual que antes para los demás documentos.
CREATE OR REPLACE FUNCTION fn_siguiente_consecutivo(p_empresa UUID, p_documento TEXT) RETURNS TEXT AS $$
DECLARE c consecutivos; anio_actual INT := EXTRACT(YEAR FROM (now() AT TIME ZONE 'America/Bogota'))::INT; n TEXT;
BEGIN
  INSERT INTO consecutivos (empresa_id, documento, prefijo, digitos, reinicio_anual, anio)
  VALUES (p_empresa, p_documento,
          CASE p_documento WHEN 'MANIFIESTO' THEN 'TV' WHEN 'INSPECCION' THEN 'INS-' WHEN 'ACTA' THEN 'PSAP' WHEN 'CERT_COMERCIAL' THEN 'CC-'
                           WHEN 'COTIZACION' THEN 'COT-' ELSE '' END,
          CASE p_documento WHEN 'MANIFIESTO' THEN 4 WHEN 'ACTA' THEN 0 WHEN 'CERT_COMERCIAL' THEN 4 WHEN 'COTIZACION' THEN 4 ELSE 5 END,
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

-- El portal de clientes no lee el módulo comercial
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['prospectos', 'contactos_comerciales', 'oportunidades', 'actividades_comerciales', 'cotizaciones', 'cotizacion_items'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY rls_portal_sin_acceso ON %I USING (fn_rls_cliente() IS NULL) WITH CHECK (fn_rls_cliente() IS NULL)', t);
  END LOOP;
END $$;
