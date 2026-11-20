-- Base de la Cuenta Terry-App (portal del ecosistema). Es aparte de la de cada módulo: aquí solo viven las personas,
-- su contraseña y su verificación en dos pasos, sus sesiones y a qué módulos pueden entrar. Ver docs/ECOSISTEMA.md.

CREATE TABLE IF NOT EXISTS cuentas (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email             VARCHAR(150) NOT NULL,
  nombre            VARCHAR(150) NOT NULL,
  clave_hash        VARCHAR(200),               -- vacía hasta que la persona use su enlace de invitación
  totp_secreto      VARCHAR(200),               -- cifrado (AES-GCM) con una llave que no está en la base
  totp_pendiente    VARCHAR(200),
  totp_desde        TIMESTAMPTZ,
  totp_ultimo_paso  BIGINT,                     -- cada código de la app sirve una sola vez
  es_admin          BOOLEAN NOT NULL DEFAULT false,
  activa            BOOLEAN NOT NULL DEFAULT true,
  intentos_fallidos INT NOT NULL DEFAULT 0,
  bloqueada_hasta   TIMESTAMPTZ,
  ultimo_ingreso    TIMESTAMPTZ,
  creada_en         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_cuentas_email CHECK (email = lower(email) AND email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_cuentas_email ON cuentas (email);

-- A qué módulos entra cada persona (los administradores del portal entran a todos)
CREATE TABLE IF NOT EXISTS accesos (
  cuenta_id UUID NOT NULL REFERENCES cuentas(id) ON DELETE CASCADE,
  modulo    VARCHAR(30) NOT NULL CHECK (modulo IN ('residuos', 'mantenimiento', 'crm', 'planta')),
  PRIMARY KEY (cuenta_id, modulo)
);

CREATE TABLE IF NOT EXISTS sesiones (
  id           UUID PRIMARY KEY,
  cuenta_id    UUID NOT NULL REFERENCES cuentas(id) ON DELETE CASCADE,
  secreto_hash CHAR(64) NOT NULL,               -- solo la huella: la cookie lleva el secreto
  creada_en    TIMESTAMPTZ NOT NULL DEFAULT now(),
  expira_en    TIMESTAMPTZ NOT NULL,
  revocada_en  TIMESTAMPTZ,
  ip           VARCHAR(64),
  agente       VARCHAR(300)
);
CREATE INDEX IF NOT EXISTS ix_sesiones_cuenta ON sesiones (cuenta_id);

CREATE TABLE IF NOT EXISTS codigos_respaldo (
  cuenta_id   UUID NOT NULL REFERENCES cuentas(id) ON DELETE CASCADE,
  codigo_hash CHAR(64) NOT NULL,
  usado_en    TIMESTAMPTZ,
  PRIMARY KEY (cuenta_id, codigo_hash)
);

-- Enlaces de invitación o de recuperación de contraseña (72 horas, una sola vez)
CREATE TABLE IF NOT EXISTS enlaces (
  token_hash CHAR(64) PRIMARY KEY,
  cuenta_id  UUID NOT NULL REFERENCES cuentas(id) ON DELETE CASCADE,
  expira_en  TIMESTAMPTZ NOT NULL,
  usado_en   TIMESTAMPTZ,
  creado_en  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Límite de intentos por ventana de tiempo (IP, correo o cuenta)
CREATE TABLE IF NOT EXISTS intentos (
  clave    VARCHAR(200) NOT NULL,
  ventana  TIMESTAMPTZ NOT NULL,
  cantidad INT NOT NULL,
  PRIMARY KEY (clave, ventana)
);

-- Bitácora: ingresos, fallos, bloqueos, pases a los módulos y cambios de la administración
CREATE TABLE IF NOT EXISTS eventos (
  id        BIGSERIAL PRIMARY KEY,
  fecha     TIMESTAMPTZ NOT NULL DEFAULT now(),
  cuenta_id UUID REFERENCES cuentas(id) ON DELETE SET NULL,
  actor_id  UUID,
  tipo      VARCHAR(40) NOT NULL,
  ip        VARCHAR(64),
  detalle   JSONB NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS ix_eventos_fecha ON eventos (fecha DESC);
CREATE INDEX IF NOT EXISTS ix_eventos_cuenta ON eventos (cuenta_id, fecha DESC);
