-- Notificaciones push (Web Push con llaves VAPID): una suscripción por navegador o teléfono de cada persona. Avisan de
-- solicitudes de recolección nuevas, manifiestos sin grabar, inspecciones no aprobadas y las alertas del día por rol.
-- La suscripción no es un registro legal: se borra cuando la persona apaga los avisos o el servicio la da por vencida.
CREATE TABLE suscripciones_push (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id   UUID NOT NULL REFERENCES empresas(id),
  usuario_id   UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  endpoint     TEXT NOT NULL,
  p256dh       VARCHAR(200) NOT NULL,
  auth         VARCHAR(100) NOT NULL,
  agente       VARCHAR(300),
  creada_en    TIMESTAMPTZ NOT NULL DEFAULT now(),
  ultimo_envio TIMESTAMPTZ,
  fallos       INT NOT NULL DEFAULT 0,
  CONSTRAINT chk_push_endpoint CHECK (endpoint ~ '^https://')
);
CREATE UNIQUE INDEX ux_suscripciones_push_endpoint ON suscripciones_push (endpoint);
CREATE INDEX ix_suscripciones_push_usuario ON suscripciones_push (usuario_id);

-- El portal de clientes no ve las suscripciones del personal
ALTER TABLE suscripciones_push ENABLE ROW LEVEL SECURITY;
ALTER TABLE suscripciones_push FORCE ROW LEVEL SECURITY;
CREATE POLICY rls_portal_sin_acceso ON suscripciones_push USING (fn_rls_cliente() IS NULL) WITH CHECK (fn_rls_cliente() IS NULL);
