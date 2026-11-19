-- Portal de clientes (19-11-2026). Requisitos de producción §2: rol CLIENTE ligado a un cliente, con perfil
-- (administrador del cliente o consulta) y sedes opcionales, y DOBLE BARRERA: el API filtra por cliente y, además,
-- la base (Row Level Security) solo deja ver las filas del cliente cuando la petición viene del portal.

-- 1. Usuario del portal: cliente, perfil y sedes permitidas (sin sedes = todas las del cliente)
CREATE TYPE "PerfilPortal" AS ENUM ('ADMIN', 'CONSULTA');
ALTER TABLE usuarios
  ADD COLUMN cliente_id UUID REFERENCES clientes(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD COLUMN perfil_portal "PerfilPortal",
  ADD CONSTRAINT chk_usuario_portal CHECK ((cliente_id IS NULL) = (perfil_portal IS NULL)),
  ADD CONSTRAINT chk_usuario_portal_campo CHECK (cliente_id IS NULL OR NOT (es_conductor OR es_auxiliar));
CREATE INDEX ix_usuario_cliente ON usuarios (cliente_id) WHERE cliente_id IS NOT NULL;

CREATE OR REPLACE FUNCTION fn_usuario_portal_valido() RETURNS trigger AS $$
BEGIN
  IF NEW.cliente_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM clientes WHERE id = NEW.cliente_id AND empresa_id = NEW.empresa_id) THEN
    RAISE EXCEPTION 'El cliente del usuario del portal no es de la misma empresa.';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_usuario_portal_valido BEFORE INSERT OR UPDATE OF cliente_id, empresa_id ON usuarios FOR EACH ROW EXECUTE FUNCTION fn_usuario_portal_valido();

CREATE TABLE usuario_sucursales (
  usuario_id  UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE ON UPDATE CASCADE,
  sucursal_id UUID NOT NULL REFERENCES sucursales(id) ON DELETE CASCADE ON UPDATE CASCADE,
  PRIMARY KEY (usuario_id, sucursal_id)
);
CREATE OR REPLACE FUNCTION fn_usuario_sucursal_valida() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM usuarios u JOIN sucursales s ON s.cliente_id = u.cliente_id WHERE u.id = NEW.usuario_id AND s.id = NEW.sucursal_id) THEN
    RAISE EXCEPTION 'La sede no es del cliente del usuario del portal.';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_usuario_sucursal_valida BEFORE INSERT OR UPDATE ON usuario_sucursales FOR EACH ROW EXECUTE FUNCTION fn_usuario_sucursal_valida();

-- 2. Segunda barrera (RLS). El API fija el cliente en cada transacción del portal:
--      SELECT set_config('app.cliente_id', '<uuid>', true)
--    Sin ese valor (personal de Terra Viva, tareas internas, migraciones) las políticas dejan ver todo, como antes.
--    FORCE: el dueño de las tablas (el usuario de la aplicación) también queda sujeto a las políticas.
CREATE OR REPLACE FUNCTION fn_rls_cliente() RETURNS uuid AS $$
  SELECT NULLIF(current_setting('app.cliente_id', true), '')::uuid
$$ LANGUAGE sql STABLE;

DO $$
DECLARE t TEXT;
BEGIN
  -- Tablas con la columna cliente_id (o el propio cliente)
  FOREACH t IN ARRAY ARRAY['sucursales', 'declaraciones', 'solicitudes', 'manifiestos', 'actas', 'cargues_masivos'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY rls_portal_cliente ON %I USING (fn_rls_cliente() IS NULL OR cliente_id = fn_rls_cliente())', t);
  END LOOP;
END $$;

ALTER TABLE clientes ENABLE ROW LEVEL SECURITY;
ALTER TABLE clientes FORCE ROW LEVEL SECURITY;
CREATE POLICY rls_portal_cliente ON clientes USING (fn_rls_cliente() IS NULL OR id = fn_rls_cliente());

-- Usuarios: el portal ve los de su cliente y al personal de Terra Viva (nombres en sus documentos), nunca a otros clientes
ALTER TABLE usuarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE usuarios FORCE ROW LEVEL SECURITY;
CREATE POLICY rls_portal_cliente ON usuarios USING (fn_rls_cliente() IS NULL OR cliente_id IS NULL OR cliente_id = fn_rls_cliente());

-- Tablas hijas: por su documento padre
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('solicitud_items',           'EXISTS (SELECT 1 FROM solicitudes p WHERE p.id = solicitud_id AND p.cliente_id = fn_rls_cliente())'),
      ('manifiesto_items',          'EXISTS (SELECT 1 FROM manifiestos p WHERE p.id = manifiesto_id AND p.cliente_id = fn_rls_cliente())'),
      ('manifiesto_evidencias',     'EXISTS (SELECT 1 FROM manifiestos p WHERE p.id = manifiesto_id AND p.cliente_id = fn_rls_cliente())'),
      ('conciliaciones',            'EXISTS (SELECT 1 FROM manifiestos p WHERE p.id = manifiesto_id AND p.cliente_id = fn_rls_cliente())'),
      ('conciliacion_items',        'EXISTS (SELECT 1 FROM conciliaciones c JOIN manifiestos p ON p.id = c.manifiesto_id WHERE c.id = conciliacion_id AND p.cliente_id = fn_rls_cliente())'),
      ('tarifas',                   'EXISTS (SELECT 1 FROM declaraciones p WHERE p.id = declaracion_id AND p.cliente_id = fn_rls_cliente())'),
      ('declaracion_sucursales',    'EXISTS (SELECT 1 FROM declaraciones p WHERE p.id = declaracion_id AND p.cliente_id = fn_rls_cliente())'),
      ('declaracion_disposiciones', 'EXISTS (SELECT 1 FROM declaraciones p WHERE p.id = declaracion_id AND p.cliente_id = fn_rls_cliente())'),
      ('declaracion_riesgos',       'EXISTS (SELECT 1 FROM declaraciones p WHERE p.id = declaracion_id AND p.cliente_id = fn_rls_cliente())'),
      ('declaracion_etiquetados',   'EXISTS (SELECT 1 FROM declaraciones p WHERE p.id = declaracion_id AND p.cliente_id = fn_rls_cliente())'),
      ('usuario_sucursales',        'EXISTS (SELECT 1 FROM usuarios p WHERE p.id = usuario_id AND p.cliente_id = fn_rls_cliente())')
    ) AS x(tabla, condicion)
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', r.tabla);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', r.tabla);
    EXECUTE format('CREATE POLICY rls_portal_cliente ON %I USING (fn_rls_cliente() IS NULL OR %s)', r.tabla, r.condicion);
  END LOOP;
END $$;
