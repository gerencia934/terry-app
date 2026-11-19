-- Cola de trabajos (requisitos de producción §1): los archivos pesados (ZIP de certificados, Excel) ya no se generan
-- durante la petición. El usuario los pide, el API los prepara aparte y le avisa con un enlace firmado de 5 minutos.
-- Vive en PostgreSQL (no exige Redis): cada copia del API toma un trabajo con FOR UPDATE SKIP LOCKED, así que dos
-- copias nunca preparan el mismo. El archivo preparado es una copia: se borra cuando vence (lo legal no se toca).
CREATE TYPE "EstadoTrabajo" AS ENUM ('PENDIENTE', 'EN_CURSO', 'LISTO', 'FALLIDO', 'VENCIDO');

CREATE TABLE trabajos (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id    UUID NOT NULL REFERENCES empresas(id),
  usuario_id    UUID NOT NULL REFERENCES usuarios(id),
  tipo          VARCHAR(40) NOT NULL,             -- ZIP_ACTAS, EXCEL_CONCILIACION, EXCEL_COSTOS_RUTAS…
  titulo        VARCHAR(200) NOT NULL,            -- lo que ve el usuario: «12 certificados en ZIP»
  parametros    JSONB NOT NULL DEFAULT '{}'::jsonb,
  estado        "EstadoTrabajo" NOT NULL DEFAULT 'PENDIENTE',
  intentos      SMALLINT NOT NULL DEFAULT 0,
  error         VARCHAR(500),
  archivo       TEXT,                             -- clave del archivo preparado (almacenamiento)
  nombre        VARCHAR(200),                     -- nombre con el que se descarga
  bytes         INTEGER,
  creado_en     TIMESTAMPTZ NOT NULL DEFAULT now(),
  iniciado_en   TIMESTAMPTZ,
  terminado_en  TIMESTAMPTZ,
  vence_en      TIMESTAMPTZ,                      -- después se borra el archivo preparado
  descargado_en TIMESTAMPTZ,
  CONSTRAINT chk_trabajo_listo CHECK (estado <> 'LISTO' OR (archivo IS NOT NULL AND nombre IS NOT NULL AND vence_en IS NOT NULL)),
  CONSTRAINT chk_trabajo_fallido CHECK (estado <> 'FALLIDO' OR error IS NOT NULL),
  CONSTRAINT chk_trabajo_intentos CHECK (intentos BETWEEN 0 AND 10)
);
-- La cola: lo pendiente, en orden de llegada
CREATE INDEX ix_trabajos_cola ON trabajos (creado_en) WHERE estado = 'PENDIENTE';
-- «Mis descargas»
CREATE INDEX ix_trabajos_usuario ON trabajos (usuario_id, creado_en DESC);
