-- Conexión con Mantenimiento (docs/ECOSISTEMA.md). Cada módulo guarda su propia copia: Residuos sabe qué vehículos están
-- en taller aunque Mantenimiento esté caído, y lo que Residuos le debe avisar espera aquí hasta que Mantenimiento responda.

-- Ventanas de taller que envía Mantenimiento (PUT/DELETE …/integraciones/mantenimiento/bloqueos/{id}); su id es la llave
CREATE TABLE bloqueos_mantenimiento (
  id                VARCHAR(80) PRIMARY KEY,
  empresa_id        UUID NOT NULL REFERENCES empresas(id),
  vehiculo_id       UUID REFERENCES vehiculos(id),
  placa             VARCHAR(12) NOT NULL,
  orden_id          VARCHAR(80),
  consecutivo       VARCHAR(40),
  desde             TIMESTAMPTZ NOT NULL,
  hasta             TIMESTAMPTZ NOT NULL,
  motivo            VARCHAR(500) NOT NULL,
  tipo              VARCHAR(20),
  criticidad        VARCHAR(20),
  detiene_operacion BOOLEAN NOT NULL DEFAULT true,
  taller            VARCHAR(200),
  liberado_en       TIMESTAMPTZ,
  creado_en         TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_en    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_bloqueo_mto_ventana CHECK (hasta > desde)
);
CREATE INDEX ix_bloqueos_mto_vehiculo ON bloqueos_mantenimiento (vehiculo_id, desde, hasta);

-- Bandeja de salida hacia Mantenimiento: preoperacionales con ítems NO OK y kilómetros al cerrar una ruta
CREATE TABLE envios_mantenimiento (
  id           BIGSERIAL PRIMARY KEY,
  empresa_id   UUID NOT NULL REFERENCES empresas(id),
  tipo         VARCHAR(20) NOT NULL CHECK (tipo IN ('PREOPERACIONAL', 'LECTURA')),
  llave        VARCHAR(120) NOT NULL,
  cuerpo       JSONB NOT NULL,
  intentos     INT NOT NULL DEFAULT 0,
  ultimo_error VARCHAR(300),
  siguiente_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  enviado_en   TIMESTAMPTZ,
  creado_en    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ux_envios_mto UNIQUE (tipo, llave)
);
CREATE INDEX ix_envios_mto_pendientes ON envios_mantenimiento (siguiente_en);

-- El portal de clientes no ve nada de esto
ALTER TABLE bloqueos_mantenimiento ENABLE ROW LEVEL SECURITY;
ALTER TABLE bloqueos_mantenimiento FORCE ROW LEVEL SECURITY;
CREATE POLICY rls_portal_sin_acceso ON bloqueos_mantenimiento USING (fn_rls_cliente() IS NULL) WITH CHECK (fn_rls_cliente() IS NULL);
ALTER TABLE envios_mantenimiento ENABLE ROW LEVEL SECURITY;
ALTER TABLE envios_mantenimiento FORCE ROW LEVEL SECURITY;
CREATE POLICY rls_portal_sin_acceso ON envios_mantenimiento USING (fn_rls_cliente() IS NULL) WITH CHECK (fn_rls_cliente() IS NULL);
