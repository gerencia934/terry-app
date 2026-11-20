-- GPS de la flota con Wialon (requisitos de producción 7.2). TERRY-GO solo LEE de Wialon (token de solo lectura):
-- - cada vehículo se relaciona con su unidad de Wialon (por la placa o a mano);
-- - última posición de cada vehículo (en vivo, cada 30 a 60 segundos);
-- - recorrido real y kilómetros de cada ruta, como evidencia del manifiesto de transporte;
-- - llegada, salida y tiempo en sitio en cada parada (geocerca de la sede) y en la planta PSA Los Pinos;
-- - paradas no programadas con carga RESPEL y desvíos de la ruta, que quedan como evidencia y se revisan con una nota.
-- Si Wialon falla, la operación sigue igual (las etapas las marca el conductor) y se avisa.

-- 1) Placa ↔ unidad de Wialon
ALTER TABLE vehiculos
  ADD COLUMN wialon_unidad_id INTEGER,
  ADD COLUMN wialon_nombre VARCHAR(100),
  ADD CONSTRAINT chk_vehiculo_wialon CHECK (wialon_unidad_id IS NULL OR wialon_unidad_id > 0);
CREATE UNIQUE INDEX ux_vehiculos_wialon ON vehiculos (empresa_id, wialon_unidad_id) WHERE wialon_unidad_id IS NOT NULL;

-- 2) Puntos del recorrido: del celular del conductor o de Wialon. El mismo punto de Wialon no se guarda dos veces.
--    La regla de la base sigue igual para los dos: solo se guardan puntos de las etapas con rastreo.
ALTER TABLE ruta_rastreo
  ADD COLUMN fuente VARCHAR(8) NOT NULL DEFAULT 'CELULAR',
  ADD CONSTRAINT chk_rastreo_fuente CHECK (fuente IN ('CELULAR', 'WIALON'));
CREATE UNIQUE INDEX ux_rastreo_wialon ON ruta_rastreo (ruta_id, registrado_en) WHERE fuente = 'WIALON';

-- 3) Última posición de cada vehículo (se reescribe en cada consulta; no es evidencia)
CREATE TABLE vehiculos_gps (
  vehiculo_id    UUID PRIMARY KEY REFERENCES vehiculos(id),
  unidad_id      INTEGER NOT NULL,
  latitud        NUMERIC(9,6) NOT NULL,
  longitud       NUMERIC(9,6) NOT NULL,
  velocidad_kmh  NUMERIC(5,1),
  rumbo          SMALLINT,
  posicion_en    TIMESTAMPTZ NOT NULL, -- hora del GPS
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_vgps_coord CHECK (latitud BETWEEN -90 AND 90 AND longitud BETWEEN -180 AND 180)
);

-- 4) Resumen GPS de cada ruta: salida y llegada a la planta, kilómetros, puntos y el estado de los detectores
CREATE TABLE rutas_gps (
  ruta_id         UUID PRIMARY KEY REFERENCES rutas(id) ON DELETE CASCADE,
  vehiculo_id     UUID NOT NULL REFERENCES vehiculos(id),
  unidad_id       INTEGER NOT NULL,
  procesado_hasta TIMESTAMPTZ NOT NULL, -- hora del último mensaje de Wialon procesado
  puntos          INTEGER NOT NULL DEFAULT 0,
  km              NUMERIC(9,2) NOT NULL DEFAULT 0,
  salida_planta   TIMESTAMPTZ,
  llegada_planta  TIMESTAMPTZ,
  estado          JSONB NOT NULL DEFAULT '{}'::jsonb,
  cerrada         BOOLEAN NOT NULL DEFAULT false, -- la ruta terminó y ya se procesó su último tramo
  actualizado_en  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_rgps_km CHECK (km >= 0 AND puntos >= 0),
  CONSTRAINT chk_rgps_planta CHECK (llegada_planta IS NULL OR salida_planta IS NULL OR llegada_planta >= salida_planta)
);

-- 5) Llegada, salida y tiempo en sitio de cada parada (geocerca de la sede)
CREATE TABLE paradas_gps (
  parada_id         UUID PRIMARY KEY REFERENCES ruta_paradas(id) ON DELETE CASCADE,
  ruta_id           UUID NOT NULL REFERENCES rutas(id) ON DELETE CASCADE,
  llegada           TIMESTAMPTZ,
  salida            TIMESTAMPTZ,
  dentro_desde      TIMESTAMPTZ, -- visita en curso
  segundos_en_sitio INTEGER NOT NULL DEFAULT 0,
  actualizado_en    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_pgps_horas CHECK (salida IS NULL OR llegada IS NULL OR salida >= llegada),
  CONSTRAINT chk_pgps_seg CHECK (segundos_en_sitio >= 0)
);
CREATE INDEX ix_paradas_gps_ruta ON paradas_gps (ruta_id);

-- 6) Paradas no programadas con RESPEL y desvíos: evidencia. No se borran y lo que registró el GPS no se cambia; solo se
--    cierran (cuando el vehículo sigue) y se marcan revisados con una nota.
CREATE TABLE eventos_gps (
  id           SERIAL PRIMARY KEY,
  empresa_id   UUID NOT NULL REFERENCES empresas(id),
  ruta_id      UUID NOT NULL REFERENCES rutas(id),
  vehiculo_id  UUID NOT NULL REFERENCES vehiculos(id),
  tipo         VARCHAR(25) NOT NULL,
  inicio       TIMESTAMPTZ NOT NULL,
  fin          TIMESTAMPTZ,
  latitud      NUMERIC(9,6) NOT NULL,
  longitud     NUMERIC(9,6) NOT NULL,
  con_respel   BOOLEAN NOT NULL DEFAULT false,
  detalle      JSONB NOT NULL DEFAULT '{}'::jsonb,
  revisado_por UUID REFERENCES usuarios(id),
  revisado_en  TIMESTAMPTZ,
  nota         VARCHAR(300),
  creado_en    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_egps_tipo CHECK (tipo IN ('PARADA_NO_PROGRAMADA', 'DESVIO')),
  CONSTRAINT chk_egps_fin CHECK (fin IS NULL OR fin >= inicio),
  CONSTRAINT chk_egps_revision CHECK ((revisado_en IS NULL) = (revisado_por IS NULL)
                                      AND (revisado_en IS NULL OR length(btrim(COALESCE(nota, ''))) >= 3))
);
CREATE INDEX ix_eventos_gps_ruta ON eventos_gps (ruta_id, inicio);
CREATE INDEX ix_eventos_gps_sin_revisar ON eventos_gps (empresa_id, inicio DESC) WHERE revisado_en IS NULL;

CREATE OR REPLACE FUNCTION fn_eventos_gps_evidencia() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Los eventos del GPS son evidencia: no se borran';
  END IF;
  IF NEW.tipo <> OLD.tipo OR NEW.empresa_id <> OLD.empresa_id OR NEW.ruta_id <> OLD.ruta_id OR NEW.vehiculo_id <> OLD.vehiculo_id
     OR NEW.inicio <> OLD.inicio OR NEW.latitud <> OLD.latitud OR NEW.longitud <> OLD.longitud OR NEW.creado_en <> OLD.creado_en THEN
    RAISE EXCEPTION 'Lo que registró el GPS no se cambia: el evento solo se cierra o se marca revisado con una nota';
  END IF;
  IF OLD.fin IS NOT NULL AND NEW.fin IS DISTINCT FROM OLD.fin THEN
    RAISE EXCEPTION 'El evento del GPS ya se cerró: su hora de fin no se cambia';
  END IF;
  IF OLD.revisado_en IS NOT NULL AND (NEW.revisado_en IS DISTINCT FROM OLD.revisado_en OR NEW.revisado_por IS DISTINCT FROM OLD.revisado_por
                                      OR NEW.nota IS DISTINCT FROM OLD.nota) THEN
    RAISE EXCEPTION 'El evento ya fue revisado: la revisión no se cambia';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_eventos_gps_evidencia BEFORE UPDATE OR DELETE ON eventos_gps
  FOR EACH ROW EXECUTE FUNCTION fn_eventos_gps_evidencia();

-- 7) Estado de la conexión con Wialon (para avisar si deja de responder). «ocupado_hasta» evita que dos copias del API
--    procesen al mismo tiempo; vence solo si una copia se cae a mitad de camino.
CREATE TABLE wialon_estado (
  empresa_id      UUID PRIMARY KEY REFERENCES empresas(id),
  ultimo_intento  TIMESTAMPTZ,
  ultimo_ok       TIMESTAMPTZ,
  fallos_seguidos INTEGER NOT NULL DEFAULT 0,
  error           VARCHAR(300),
  ocupado_hasta   TIMESTAMPTZ,
  detalle         JSONB NOT NULL DEFAULT '{}'::jsonb -- unidades de la cuenta (id, nombre, vehículo y hora de la última posición)
);

-- El portal de clientes no lee estas tablas
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['vehiculos_gps', 'rutas_gps', 'paradas_gps', 'eventos_gps', 'wialon_estado'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY rls_portal_sin_acceso ON %I USING (fn_rls_cliente() IS NULL) WITH CHECK (fn_rls_cliente() IS NULL)', t);
  END LOOP;
END $$;
