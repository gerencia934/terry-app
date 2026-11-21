-- Roles configurables (20-11-2026, pedido de la gerencia: «una sección de roles donde se describan todas las funciones,
-- decidamos cuáles otorgar, vengan marcadas las predeterminadas y podamos crear roles nuevos, como en Grinclic»).
-- Como en Grinclic, cada rol tiene un solo acceso al sistema: OFICINA, CAMPO (conductores, auxiliares, planta) o
-- CLIENTE (el portal de clientes, que es distinto de la empresa y tiene sus propias funciones «portal.*»). Los roles de
-- siempre quedan como predeterminados (con su clave, aunque les cambien el nombre) y el portal deja de tener dos perfiles
-- fijos: cada usuario del portal lleva un rol de acceso CLIENTE (los dos predeterminados equivalen a los perfiles de antes).

CREATE TYPE "AccesoRol" AS ENUM ('OFICINA', 'CAMPO', 'CLIENTE');
ALTER TABLE roles
  ADD COLUMN clave VARCHAR(40),
  ADD COLUMN descripcion VARCHAR(400),
  ADD COLUMN acceso "AccesoRol" NOT NULL DEFAULT 'OFICINA',
  ADD COLUMN activo BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN predeterminado BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
CREATE UNIQUE INDEX ux_rol_clave ON roles (empresa_id, clave) WHERE clave IS NOT NULL;

-- 1. Los roles de siempre: predeterminados, con su clave, su acceso y su descripción
UPDATE roles SET clave = 'ADMINISTRADOR', predeterminado = TRUE,
  descripcion = 'Gerencia y administración del sistema: acceso total. No se le quitan permisos (así nadie queda por fuera de la configuración).'
  WHERE nombre = 'Administrador';
UPDATE roles SET clave = 'LOGISTICA', predeterminado = TRUE, descripcion = 'Programa rutas, atiende solicitudes, maneja manifiestos y concilia cantidades.' WHERE nombre = 'Logística';
UPDATE roles SET clave = 'HSEQ', predeterminado = TRUE, descripcion = 'Revisa y autoriza declaraciones, lleva permisos y licencias ambientales y emite los certificados.' WHERE nombre = 'HSEQ';
UPDATE roles SET clave = 'COMERCIAL', predeterminado = TRUE, descripcion = 'Clientes, declaraciones, tarifas, solicitudes y gestión comercial (reemplaza a Bigin).' WHERE nombre = 'Comercial';
UPDATE roles SET clave = 'FACTURACION', predeterminado = TRUE, descripcion = 'Tarifas, conciliaciones, facturas y pagos con Siigo.' WHERE nombre = 'Facturación';
UPDATE roles SET clave = 'CONDUCTOR', acceso = 'CAMPO', predeterminado = TRUE, descripcion = 'Opera sus rutas en el celular: inspección preoperacional, paradas y manifiestos.' WHERE nombre = 'Conductor';
UPDATE roles SET clave = 'AUXILIAR', acceso = 'CAMPO', predeterminado = TRUE, descripcion = 'Acompaña la ruta: paradas y manifiestos desde el celular.' WHERE nombre = 'Auxiliar';
UPDATE roles SET clave = 'CLIENTE_ADMIN', acceso = 'CLIENTE', predeterminado = TRUE, nombre = 'Cliente: administrador',
  descripcion = 'Administrador del portal de su empresa: ve todo, declara, pide servicios, gestiona sus sedes y sus usuarios.'
  WHERE nombre = 'Cliente (portal)';
INSERT INTO roles (id, empresa_id, nombre, clave, acceso, predeterminado, descripcion)
SELECT gen_random_uuid(), empresa_id, 'Cliente: consulta', 'CLIENTE_CONSULTA', 'CLIENTE', TRUE,
       'Consulta y descarga lo de su empresa (o de sus sedes): no declara ni pide servicios.'
  FROM roles WHERE clave = 'CLIENTE_ADMIN'
ON CONFLICT DO NOTHING;

-- 2. Funciones del portal de clientes
INSERT INTO permisos (id, codigo, nombre) VALUES
  (gen_random_uuid(), 'portal.sedes.ver', 'Ver sus sedes'),
  (gen_random_uuid(), 'portal.sedes.gestionar', 'Crear y corregir sedes'),
  (gen_random_uuid(), 'portal.declaraciones.ver', 'Ver sus declaraciones'),
  (gen_random_uuid(), 'portal.declaraciones.gestionar', 'Declarar residuos y servicios'),
  (gen_random_uuid(), 'portal.solicitudes.ver', 'Ver sus solicitudes'),
  (gen_random_uuid(), 'portal.solicitudes.pedir', 'Pedir recolecciones'),
  (gen_random_uuid(), 'portal.entregas.pedir', 'Pedir entregas en planta'),
  (gen_random_uuid(), 'portal.manifiestos.ver', 'Ver y descargar manifiestos'),
  (gen_random_uuid(), 'portal.certificados.ver', 'Ver y descargar certificados'),
  (gen_random_uuid(), 'portal.informes.ver', 'Ver informes'),
  (gen_random_uuid(), 'portal.precios.ver', 'Ver tarifas y valores'),
  (gen_random_uuid(), 'portal.usuarios.gestionar', 'Gestionar usuarios')
ON CONFLICT (codigo) DO UPDATE SET nombre = EXCLUDED.nombre;
INSERT INTO rol_permisos (rol_id, permiso_id)
SELECT r.id, p.id FROM roles r JOIN permisos p ON p.codigo LIKE 'portal.%' WHERE r.clave = 'CLIENTE_ADMIN'
ON CONFLICT DO NOTHING;
INSERT INTO rol_permisos (rol_id, permiso_id)
SELECT r.id, p.id FROM roles r JOIN permisos p ON p.codigo IN ('portal.sedes.ver', 'portal.declaraciones.ver', 'portal.solicitudes.ver',
  'portal.manifiestos.ver', 'portal.certificados.ver', 'portal.informes.ver', 'portal.precios.ver') WHERE r.clave = 'CLIENTE_CONSULTA'
ON CONFLICT DO NOTHING;

-- 3. Los usuarios del portal con perfil de consulta pasan al rol de consulta (los administradores ya tienen el otro)
UPDATE usuarios u SET rol_id = r.id FROM roles r
 WHERE u.cliente_id IS NOT NULL AND u.perfil_portal = 'CONSULTA' AND r.empresa_id = u.empresa_id AND r.clave = 'CLIENTE_CONSULTA';

-- 4. Reglas en la base ---------------------------------------------------------------------------------------------
ALTER TABLE roles ADD CONSTRAINT chk_rol_nombre CHECK (length(btrim(nombre)) >= 3);

-- El acceso de un rol no cambia (sus funciones son otras), y un predeterminado no se borra (se puede inactivar si nadie lo usa).
CREATE OR REPLACE FUNCTION fn_rol_guarda() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.predeterminado THEN RAISE EXCEPTION 'El rol «%» es predeterminado: no se borra (se puede inactivar si nadie lo usa).', OLD.nombre; END IF;
    RETURN OLD;
  END IF;
  IF NEW.acceso IS DISTINCT FROM OLD.acceso THEN RAISE EXCEPTION 'El acceso de un rol no se cambia: cree otro rol.'; END IF;
  IF NEW.clave IS DISTINCT FROM OLD.clave OR NEW.predeterminado IS DISTINCT FROM OLD.predeterminado THEN
    RAISE EXCEPTION 'Un rol no deja de ser predeterminado ni cambia de clave.';
  END IF;
  IF OLD.clave = 'ADMINISTRADOR' AND NOT NEW.activo THEN RAISE EXCEPTION 'El rol Administrador no se inactiva.'; END IF;
  IF OLD.activo AND NOT NEW.activo AND EXISTS (SELECT 1 FROM usuarios WHERE rol_id = OLD.id AND activo) THEN
    RAISE EXCEPTION 'El rol «%» tiene usuarios activos: páselos a otro rol antes de inactivarlo.', OLD.nombre;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_rol_guarda BEFORE UPDATE OR DELETE ON roles FOR EACH ROW EXECUTE FUNCTION fn_rol_guarda();

-- Un rol del portal solo lleva funciones del portal, y uno de la empresa ninguna del portal. El Administrador conserva «*».
CREATE OR REPLACE FUNCTION fn_rol_permiso_acceso() RETURNS trigger AS $$
DECLARE v_acceso "AccesoRol"; v_clave TEXT; v_codigo TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    SELECT clave INTO v_clave FROM roles WHERE id = OLD.rol_id;
    SELECT codigo INTO v_codigo FROM permisos WHERE id = OLD.permiso_id;
    IF v_clave = 'ADMINISTRADOR' AND v_codigo = '*' THEN RAISE EXCEPTION 'El rol Administrador conserva el acceso total.'; END IF;
    RETURN OLD;
  END IF;
  SELECT acceso INTO v_acceso FROM roles WHERE id = NEW.rol_id;
  SELECT codigo INTO v_codigo FROM permisos WHERE id = NEW.permiso_id;
  IF (v_acceso = 'CLIENTE') <> (v_codigo LIKE 'portal.%') THEN
    RAISE EXCEPTION 'La función «%» no corresponde al acceso del rol (el portal de clientes y la empresa tienen funciones distintas).', v_codigo;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_rol_permiso_acceso BEFORE INSERT OR UPDATE OR DELETE ON rol_permisos FOR EACH ROW EXECUTE FUNCTION fn_rol_permiso_acceso();

-- Un usuario del portal lleva un rol del portal de su misma empresa, y uno de la empresa un rol de la empresa. Un rol
-- inactivo no se asigna.
CREATE OR REPLACE FUNCTION fn_usuario_rol_acceso() RETURNS trigger AS $$
DECLARE r RECORD;
BEGIN
  SELECT acceso, activo, empresa_id INTO r FROM roles WHERE id = NEW.rol_id;
  IF NOT FOUND OR r.empresa_id <> NEW.empresa_id THEN RAISE EXCEPTION 'El rol no es de la empresa del usuario.'; END IF;
  IF (NEW.cliente_id IS NOT NULL) <> (r.acceso = 'CLIENTE') THEN
    RAISE EXCEPTION 'El rol no corresponde: un usuario del portal de clientes lleva un rol del portal, y uno de la empresa, un rol de la empresa.';
  END IF;
  IF NOT r.activo AND (TG_OP = 'INSERT' OR NEW.rol_id IS DISTINCT FROM OLD.rol_id) THEN RAISE EXCEPTION 'El rol está inactivo: actívelo o elija otro.'; END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_usuario_rol_acceso BEFORE INSERT OR UPDATE OF rol_id, cliente_id, empresa_id ON usuarios FOR EACH ROW EXECUTE FUNCTION fn_usuario_rol_acceso();
