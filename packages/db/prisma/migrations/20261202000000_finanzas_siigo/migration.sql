-- Siigo Nube (gerencia, 19-11-2026): trazabilidad financiera de los manifiestos y regla del certificado por cliente.
-- La información financiera vive en tablas aparte: ninguna pantalla de campo ni del portal la trae por descuido, y la
-- base no se la deja leer a una sesión del portal (RLS).
CREATE TYPE "ReglaCertificado" AS ENUM ('AL_VENCER', 'EXIGIR_FACTURA', 'EXIGIR_PAGO', 'LIBRE');
CREATE TYPE "EstadoPagoManifiesto" AS ENUM ('PENDIENTE', 'PAGADO', 'LIBRE');
CREATE TYPE "EstadoFacturaSiigo" AS ENUM ('PENDIENTE', 'ABONADA', 'PAGADA', 'ANULADA');

-- Regla de certificado de cada cliente:
--   AL_VENCER       la regla amable de siempre: en el portal se retiene si hay una factura vencida (días de gracia en Ajustes)
--   EXIGIR_FACTURA  no se emite ni se descarga sin factura
--   EXIGIR_PAGO     no se emite ni se descarga sin pago
--   LIBRE           sin restricciones financieras
ALTER TABLE clientes ADD COLUMN regla_certificado "ReglaCertificado" NOT NULL DEFAULT 'AL_VENCER';

-- Facturas de venta traídas de Siigo (copia local para cruzarlas con los manifiestos y verlas sin consultar Siigo)
CREATE TABLE facturas_siigo (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id          UUID NOT NULL REFERENCES empresas(id),
  siigo_id            VARCHAR(60) NOT NULL,
  nombre              VARCHAR(30) NOT NULL,                -- FV-2-1234
  fecha               DATE NOT NULL,
  vence               DATE,
  total               NUMERIC(16,2) NOT NULL,
  saldo               NUMERIC(16,2) NOT NULL,
  notas_credito       NUMERIC(16,2) NOT NULL DEFAULT 0,    -- lo que anulan sus notas crédito
  estado              "EstadoFacturaSiigo" NOT NULL,
  estado_dian         VARCHAR(30),
  cliente_nit         VARCHAR(20) NOT NULL,
  cliente_id          UUID REFERENCES clientes(id),        -- el cliente de TERRY-GO con ese NIT
  manifiestos_citados TEXT[] NOT NULL DEFAULT '{}',        -- números de manifiesto que cita la factura
  url_publica         TEXT,
  sincronizada_en     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX facturas_siigo_empresa_id_siigo_id_key ON facturas_siigo (empresa_id, siigo_id);
CREATE INDEX ix_facturas_siigo_nombre ON facturas_siigo (empresa_id, nombre);

-- Qué factura cubre qué manifiesto. Origen: CITADO (la factura cita el número del manifiesto), NUMERO (la conciliación
-- tiene registrado el número de la factura) o MANUAL (lo enlazó facturación).
CREATE TABLE factura_manifiestos (
  factura_id    UUID NOT NULL REFERENCES facturas_siigo(id) ON DELETE CASCADE,
  manifiesto_id UUID NOT NULL REFERENCES manifiestos(id),
  origen        VARCHAR(20) NOT NULL,
  creado_en     TIMESTAMPTZ NOT NULL DEFAULT now(),
  creado_por_id UUID REFERENCES usuarios(id),
  PRIMARY KEY (factura_id, manifiesto_id),
  CONSTRAINT chk_factura_manifiesto_origen CHECK (origen IN ('CITADO', 'NUMERO', 'MANUAL'))
);
CREATE INDEX ix_factura_manifiestos_manifiesto ON factura_manifiestos (manifiesto_id);

-- Estado financiero de cada manifiesto realizado (lo recalcula la sincronización y cada cambio de facturación).
-- «Libre»: facturación lo marca así (servicio sin cobro, acuerdo especial), siempre con su motivo.
CREATE TABLE manifiestos_finanzas (
  manifiesto_id  UUID PRIMARY KEY REFERENCES manifiestos(id),
  empresa_id     UUID NOT NULL REFERENCES empresas(id),
  facturado      BOOLEAN NOT NULL DEFAULT false,
  estado_pago    "EstadoPagoManifiesto" NOT NULL DEFAULT 'PENDIENTE',
  facturas       TEXT[] NOT NULL DEFAULT '{}',
  saldo          NUMERIC(16,2),
  vence          DATE,
  libre_motivo   VARCHAR(300),
  libre_por_id   UUID REFERENCES usuarios(id),
  libre_en       TIMESTAMPTZ,
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_finanzas_libre CHECK (libre_en IS NULL OR LENGTH(TRIM(COALESCE(libre_motivo, ''))) >= 5)
);
CREATE INDEX ix_manifiestos_finanzas ON manifiestos_finanzas (empresa_id, estado_pago, facturado);

-- Cada sincronización con Siigo: la diaria (una por día y empresa, aunque haya varias copias del API) o la del botón
CREATE TABLE sincronizaciones_siigo (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id   UUID NOT NULL REFERENCES empresas(id),
  origen       VARCHAR(20) NOT NULL,
  dia          DATE NOT NULL,
  usuario_id   UUID REFERENCES usuarios(id),
  estado       VARCHAR(20) NOT NULL DEFAULT 'EN_CURSO',
  iniciada_en  TIMESTAMPTZ NOT NULL DEFAULT now(),
  terminada_en TIMESTAMPTZ,
  facturas     INT NOT NULL DEFAULT 0,
  enlazadas    INT NOT NULL DEFAULT 0,
  avisos       JSONB NOT NULL DEFAULT '[]'::jsonb,
  error        VARCHAR(500),
  CONSTRAINT chk_sincronizacion_origen CHECK (origen IN ('AUTOMATICA', 'MANUAL')),
  CONSTRAINT chk_sincronizacion_estado CHECK (estado IN ('EN_CURSO', 'LISTA', 'FALLIDA'))
);
CREATE UNIQUE INDEX ux_sincronizacion_siigo_diaria ON sincronizaciones_siigo (empresa_id, dia) WHERE origen = 'AUTOMATICA';
CREATE INDEX ix_sincronizaciones_siigo ON sincronizaciones_siigo (empresa_id, iniciada_en DESC);

-- Portal: la información financiera interna no existe para una sesión de cliente (ni para leer ni para escribir)
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['facturas_siigo', 'factura_manifiestos', 'manifiestos_finanzas', 'sincronizaciones_siigo'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY rls_portal_sin_finanzas ON %I USING (fn_rls_cliente() IS NULL) WITH CHECK (fn_rls_cliente() IS NULL)', t);
  END LOOP;
END $$;
