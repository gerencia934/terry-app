-- Correo diario de alertas y avisos de seguridad (requisitos de producción: registro de errores, alertas por picos de
-- ingresos fallidos, descargas masivas y errores del servidor).

-- Tareas que corren una vez al día por empresa (p. ej. el correo de alertas): la llave primaria decide qué copia del API
-- la hace, aunque haya varias.
CREATE TABLE tareas_diarias (
  empresa_id   UUID NOT NULL REFERENCES empresas(id),
  tarea        VARCHAR(40) NOT NULL,
  dia          DATE NOT NULL,
  iniciada_en  TIMESTAMPTZ NOT NULL DEFAULT now(),
  terminada_en TIMESTAMPTZ,
  detalle      JSONB NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (empresa_id, tarea, dia)
);

-- Errores inesperados del servidor (los que responden «Error interno»): quién, dónde y cuándo, sin la pila (que queda
-- solo en el registro del servidor). La firma agrupa los repetidos para avisar una vez y no llenar el correo.
CREATE TABLE errores_servidor (
  id         BIGSERIAL PRIMARY KEY,
  fecha      TIMESTAMPTZ NOT NULL DEFAULT now(),
  empresa_id UUID REFERENCES empresas(id),
  usuario_id UUID REFERENCES usuarios(id),
  metodo     VARCHAR(10) NOT NULL,
  ruta       VARCHAR(300) NOT NULL,
  mensaje    VARCHAR(500) NOT NULL,
  firma      CHAR(16) NOT NULL,
  avisado    BOOLEAN NOT NULL DEFAULT false,
  ip         VARCHAR(64)
);
CREATE INDEX ix_errores_servidor_fecha ON errores_servidor (fecha DESC);
CREATE INDEX ix_errores_servidor_firma ON errores_servidor (firma, fecha DESC);

-- Para contar rápido los ingresos fallidos y las exportaciones recientes en las alertas de seguridad
CREATE INDEX IF NOT EXISTS ix_auditoria_accion_fecha ON auditoria (accion, fecha DESC);

-- El portal de clientes no lee estas tablas
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['tareas_diarias', 'errores_servidor'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY rls_portal_sin_acceso ON %I USING (fn_rls_cliente() IS NULL) WITH CHECK (fn_rls_cliente() IS NULL)', t);
  END LOOP;
END $$;
