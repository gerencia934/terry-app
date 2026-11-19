-- Verificación en dos pasos (TOTP, RFC 6238) con códigos de respaldo (requisitos de producción §4): obligatoria para el
-- personal de Terra Viva en producción y opcional para los usuarios del portal de clientes.
ALTER TABLE usuarios
  ADD COLUMN totp_secreto TEXT,               -- secreto cifrado (AES-256-GCM); null = sin verificación en dos pasos
  ADD COLUMN totp_pendiente TEXT,             -- secreto cifrado mientras se configura (aún sin confirmar con un código)
  ADD COLUMN totp_activo_desde TIMESTAMPTZ,   -- desde cuándo está activa
  ADD COLUMN totp_ultimo_paso INTEGER,        -- último paso de 30 s usado: un mismo código no sirve dos veces
  ADD CONSTRAINT chk_totp_activo CHECK ((totp_activo_desde IS NULL) = (totp_secreto IS NULL));

-- Códigos de respaldo: de un solo uso, guardados como huella (nunca el código)
CREATE TABLE codigos_respaldo (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id  UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  codigo_hash CHAR(64) NOT NULL,
  usado_en    TIMESTAMPTZ,
  creado_en   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_codigos_respaldo_usuario ON codigos_respaldo (usuario_id);
