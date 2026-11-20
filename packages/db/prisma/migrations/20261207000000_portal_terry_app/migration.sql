-- Entrada única del ecosistema Terry-App (docs/ECOSISTEMA.md). El portal entrega un pase firmado de 60 segundos; aquí
-- cada pase sirve una sola vez, y la sesión abierta con él no vuelve a pedir la verificación en dos pasos (la hizo el
-- portal), tampoco al renovarse.
ALTER TABLE sesiones ADD COLUMN via_portal BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE pases_portal (
  jti        UUID PRIMARY KEY,
  usuario_id UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  usado_en   TIMESTAMPTZ NOT NULL DEFAULT now(),
  expira_en  TIMESTAMPTZ NOT NULL
);
CREATE INDEX ix_pases_portal_expira ON pases_portal (expira_en);
