-- Bitácora de tiempos y tareas logísticas (gerencia, 20-11-2026): los «tiempos muertos» y las actividades que no son una
-- recolección (trancón severo, espera en portería o autorización del cliente, compra de insumos…). Es el soporte real de
-- en qué se va el tiempo de la operación. Mismo estándar que la bitácora de actividades de Mantenimiento: cronómetro en el
-- celular, lista de tipos configurable, corrección propia durante 7 días y vista del equipo para los coordinadores.
CREATE TABLE "tiempos_logisticos" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "empresa_id" UUID NOT NULL,
  "usuario_id" UUID NOT NULL,          -- de quién es el tiempo
  "registrado_por" UUID NOT NULL,      -- quién lo registró (la misma persona o su coordinador)
  "tipo_id" UUID NOT NULL,             -- catalogo_items de tipo TIEMPO_LOGISTICO
  "inicio" TIMESTAMPTZ NOT NULL,
  "fin" TIMESTAMPTZ NOT NULL,
  "minutos" INTEGER GENERATED ALWAYS AS (GREATEST(0, ROUND(EXTRACT(EPOCH FROM ("fin" - "inicio")) / 60))::int) STORED,
  "nota" VARCHAR(500),
  "ruta_id" UUID,
  "parada_id" UUID,
  "vehiculo_id" UUID,
  "lat_inicio" DECIMAL(9,6), "lng_inicio" DECIMAL(9,6), "lat_fin" DECIMAL(9,6), "lng_fin" DECIMAL(9,6),
  "foto_url" TEXT,
  "costo" DECIMAL(14,0),
  "creado_en" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "actualizado_en" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "tiempos_logisticos_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "chk_tiempo_orden" CHECK ("fin" >= "inicio"),
  CONSTRAINT "chk_tiempo_duracion" CHECK ("fin" - "inicio" <= INTERVAL '24 hours'),
  CONSTRAINT "chk_tiempo_costo" CHECK ("costo" IS NULL OR "costo" >= 0)
);
CREATE INDEX "ix_tiempos_usuario" ON "tiempos_logisticos" ("usuario_id", "inicio");
CREATE INDEX "ix_tiempos_empresa" ON "tiempos_logisticos" ("empresa_id", "inicio");
ALTER TABLE "tiempos_logisticos" ADD CONSTRAINT "tiempos_logisticos_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "tiempos_logisticos" ADD CONSTRAINT "tiempos_logisticos_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "tiempos_logisticos" ADD CONSTRAINT "tiempos_logisticos_registrado_por_fkey" FOREIGN KEY ("registrado_por") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "tiempos_logisticos" ADD CONSTRAINT "tiempos_logisticos_tipo_id_fkey" FOREIGN KEY ("tipo_id") REFERENCES "catalogo_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "tiempos_logisticos" ADD CONSTRAINT "tiempos_logisticos_ruta_id_fkey" FOREIGN KEY ("ruta_id") REFERENCES "rutas"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "tiempos_logisticos" ADD CONSTRAINT "tiempos_logisticos_parada_id_fkey" FOREIGN KEY ("parada_id") REFERENCES "ruta_paradas"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "tiempos_logisticos" ADD CONSTRAINT "tiempos_logisticos_vehiculo_id_fkey" FOREIGN KEY ("vehiculo_id") REFERENCES "vehiculos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Tipos iniciales de cada empresa (se ajustan desde la bitácora de la oficina)
INSERT INTO "catalogo_items" ("id", "empresa_id", "tipo", "codigo", "nombre", "color")
SELECT gen_random_uuid(), e."id", 'TIEMPO_LOGISTICO', x.codigo, x.nombre, x.color
  FROM "empresas" e CROSS JOIN (VALUES
    ('TRANCON', 'Trancón severo', '#B42318'),
    ('PORTERIA', 'Espera en portería o autorización del cliente', '#B54708'),
    ('INSUMOS', 'Compra de insumos', '#1F4E5F'),
    ('TANQUEO', 'Tanqueo', '#475467'),
    ('FALLA', 'Falla del vehículo', '#912018'),
    ('DESCARGUE', 'Espera de descargue en planta', '#1F5E3B'),
    ('TRAMITES', 'Trámites y documentos', '#6941C6'),
    ('OTRO', 'Otro', '#667085')) AS x(codigo, nombre, color)
ON CONFLICT DO NOTHING;

-- Funciones: registrar (oficina y campo) y ver al equipo (coordinadores)
INSERT INTO "permisos" ("id", "codigo", "nombre") VALUES
  (gen_random_uuid(), 'bitacora.registrar', 'Registrar tiempos y tareas'),
  (gen_random_uuid(), 'bitacora.equipo', 'Bitácora del equipo')
ON CONFLICT ("codigo") DO UPDATE SET "nombre" = EXCLUDED."nombre";
INSERT INTO "rol_permisos" ("rol_id", "permiso_id")
SELECT r."id", p."id" FROM "roles" r JOIN "permisos" p ON p."codigo" = 'bitacora.registrar'
 WHERE r."clave" IN ('CONDUCTOR', 'AUXILIAR', 'JEFE_PLANTA', 'JEFE_OPERACIONES', 'LOGISTICA')
ON CONFLICT DO NOTHING;
INSERT INTO "rol_permisos" ("rol_id", "permiso_id")
SELECT r."id", p."id" FROM "roles" r JOIN "permisos" p ON p."codigo" = 'bitacora.equipo'
 WHERE r."clave" IN ('JEFE_OPERACIONES', 'LOGISTICA')
ON CONFLICT DO NOTHING;
