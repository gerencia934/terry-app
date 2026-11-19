-- =====================================================================
-- Módulo Declaraciones — reglas que se aplican en la base de datos.
-- Se ejecuta después de la migración generada por Prisma.
-- Ninguna pantalla, API o cargue masivo puede saltarse estas reglas.
-- Las validaciones de formulario (zod) repiten las mismas reglas para avisar antes.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Campos obligatorios según tipo (no aplican al BORRADOR)
-- ---------------------------------------------------------------------
ALTER TABLE declaraciones
  -- Residuo: secciones 2, 3 y 4 completas
  ADD CONSTRAINT chk_decl_residuo_completo CHECK (
        tipo <> 'RESIDUO' OR estado = 'BORRADOR' OR (
              tipo_residuo_id IS NOT NULL
          AND tipo_embalaje_id IS NOT NULL
          AND material_embalaje_id IS NOT NULL
          AND estado_fisico IS NOT NULL
          AND inflamable IS NOT NULL
          AND controlada_estupefacientes IS NOT NULL
          AND COALESCE(LENGTH(TRIM(descripcion_proceso)), 0) > 0)),
  -- Servicio: descripción obligatoria
  ADD CONSTRAINT chk_decl_servicio_completo CHECK (
        tipo <> 'SERVICIO' OR estado = 'BORRADOR'
        OR COALESCE(LENGTH(TRIM(descripcion_servicio)), 0) > 0),
  -- Peligroso: composición + al menos una corriente (Y o A) — Dec. 1076/2015 art. 2.2.6.1.2.1
  ADD CONSTRAINT chk_decl_peligroso CHECK (
        NOT es_peligroso OR estado = 'BORRADOR' OR (
              COALESCE(LENGTH(TRIM(composicion)), 0) > 0
          AND (codigo_a_id IS NOT NULL OR codigo_y_id IS NOT NULL))),
  -- Responsabilidad del generador aceptada para enviar
  ADD CONSTRAINT chk_decl_responsabilidad CHECK (
        estado = 'BORRADOR' OR (responsabilidad_aceptada AND aceptada_en IS NOT NULL)),
  -- Solo una declaración AUTORIZADA puede estar activa
  ADD CONSTRAINT chk_decl_activa_autorizada CHECK (NOT activa OR estado = 'AUTORIZADA'),
  -- Formatos
  ADD CONSTRAINT chk_decl_codigo_un CHECK (codigo_un IS NULL OR codigo_un ~ '^UN[0-9]{4}$'),
  ADD CONSTRAINT chk_decl_densidad CHECK ((densidad IS NULL) = (metrica_densidad_id IS NULL)),
  ADD CONSTRAINT chk_decl_densidad_pos CHECK (densidad IS NULL OR densidad > 0),
  ADD CONSTRAINT chk_decl_frecuencia CHECK (frecuencia_dias IS NULL OR frecuencia_dias BETWEEN 1 AND 366),
  ADD CONSTRAINT chk_decl_cantidad CHECK (cantidad_frecuencia IS NULL OR cantidad_frecuencia > 0),
  ADD CONSTRAINT chk_decl_auto_frecuencia CHECK (NOT solicitud_automatica OR frecuencia_dias IS NOT NULL);

ALTER TABLE tarifas
  ADD CONSTRAINT chk_tarifa_precio CHECK (precio_unitario >= 0),
  ADD CONSTRAINT chk_tarifa_vigencia CHECK (vigente_hasta IS NULL OR vigente_hasta >= vigente_desde);

-- Una sola sede principal por cliente
CREATE UNIQUE INDEX ux_sucursal_principal ON sucursales (cliente_id) WHERE es_principal;

-- ---------------------------------------------------------------------
-- 2) Coherencia de las relaciones (todo debe ser de la misma empresa / cliente)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_decl_sucursal_del_cliente() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
       SELECT 1 FROM declaraciones d JOIN sucursales s ON s.cliente_id = d.cliente_id
        WHERE d.id = NEW.declaracion_id AND s.id = NEW.sucursal_id) THEN
    RAISE EXCEPTION 'La sede no pertenece al cliente de la declaración';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_decl_sucursal_del_cliente
  BEFORE INSERT OR UPDATE ON declaracion_sucursales
  FOR EACH ROW EXECUTE FUNCTION fn_decl_sucursal_del_cliente();

-- Catálogos de la declaración: misma empresa y activos (al crear o cambiar el valor)
CREATE OR REPLACE FUNCTION fn_decl_catalogos_validos() RETURNS trigger AS $$
DECLARE malo TEXT;
BEGIN
  SELECT x.campo INTO malo FROM (VALUES
      ('Categoría',          (SELECT empresa_id = NEW.empresa_id AND activo FROM categorias_declarado WHERE id = NEW.categoria_id)),
      ('Línea de servicio',  (SELECT empresa_id = NEW.empresa_id AND activo FROM lineas_servicio      WHERE id = NEW.linea_servicio_id)),
      ('Tipo de residuo',    (SELECT empresa_id = NEW.empresa_id AND activo FROM tipos_residuo        WHERE id = NEW.tipo_residuo_id)),
      ('Tipo de embalaje',   (SELECT empresa_id = NEW.empresa_id AND activo FROM tipos_embalaje       WHERE id = NEW.tipo_embalaje_id)),
      ('Material',           (SELECT empresa_id = NEW.empresa_id AND activo FROM materiales_embalaje  WHERE id = NEW.material_embalaje_id)),
      ('Métrica densidad',   (SELECT empresa_id = NEW.empresa_id AND activo FROM metricas             WHERE id = NEW.metrica_densidad_id)),
      ('Cliente',            (SELECT empresa_id = NEW.empresa_id AND activo FROM clientes             WHERE id = NEW.cliente_id))
    ) AS x(campo, ok)
   WHERE x.ok IS FALSE
   LIMIT 1;
  IF malo IS NOT NULL THEN
    RAISE EXCEPTION '% no válido o inactivo para esta empresa', malo;
  END IF;
  -- «Otro» exige el texto
  IF NEW.estado <> 'BORRADOR' AND EXISTS (SELECT 1 FROM tipos_embalaje WHERE id = NEW.tipo_embalaje_id AND es_otro)
     AND COALESCE(LENGTH(TRIM(NEW.otro_tipo_embalaje)), 0) = 0 THEN
    RAISE EXCEPTION 'Indique cuál es el otro tipo de embalaje';
  END IF;
  IF NEW.estado <> 'BORRADOR' AND EXISTS (SELECT 1 FROM materiales_embalaje WHERE id = NEW.material_embalaje_id AND es_otro)
     AND COALESCE(LENGTH(TRIM(NEW.otro_material)), 0) = 0 THEN
    RAISE EXCEPTION 'Indique cuál es el otro material de embalaje';
  END IF;
  -- Corriente A en el campo A y corriente Y en el campo Y
  IF NEW.codigo_a_id IS NOT NULL AND (SELECT tipo FROM codigos_clasificacion WHERE id = NEW.codigo_a_id) <> 'A' THEN
    RAISE EXCEPTION 'El código del campo A no es de la lista A';
  END IF;
  IF NEW.codigo_y_id IS NOT NULL AND (SELECT tipo FROM codigos_clasificacion WHERE id = NEW.codigo_y_id) <> 'Y' THEN
    RAISE EXCEPTION 'El código del campo Y no es una corriente Y';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_decl_catalogos_validos
  BEFORE INSERT OR UPDATE OF empresa_id, cliente_id, categoria_id, linea_servicio_id, tipo_residuo_id,
    tipo_embalaje_id, material_embalaje_id, metrica_densidad_id, otro_tipo_embalaje, otro_material,
    codigo_a_id, codigo_y_id, estado
  ON declaraciones
  FOR EACH ROW EXECUTE FUNCTION fn_decl_catalogos_validos();

-- ---------------------------------------------------------------------
-- 3) PRIORIDAD #1 — CUMPLIMIENTO AMBIENTAL
--    Una declaración solo queda AUTORIZADA si:
--      a) tiene al menos una sede;
--      b) si es residuo, tiene al menos una disposición;
--      c) CADA disposición está cubierta:
--         · no requiere permiso (objeto social), o
--         · es de gestor aliado con licencia vigente, o
--         · es propia y un permiso VIGENTE / POR VENCER de la empresa la ampara.
--    Es un trigger diferido: se revisa al confirmar la transacción, cuando ya
--    existen las filas de sedes y disposiciones (formulario o cargue masivo).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_disposicion_cubierta(p_disposicion UUID, p_empresa UUID) RETURNS BOOLEAN AS $$
  SELECT CASE
    WHEN NOT d.requiere_permiso THEN TRUE
    WHEN NOT d.propia THEN EXISTS (
         SELECT 1 FROM proveedores pr
          WHERE pr.id = d.proveedor_id
            AND COALESCE(LENGTH(TRIM(pr.licencia)), 0) > 0
            AND pr.licencia_vence >= CURRENT_DATE)
    ELSE EXISTS (
         SELECT 1 FROM permiso_disposiciones pd
           JOIN permisos_ambientales p ON p.id = pd.permiso_id
          WHERE pd.disposicion_id = d.id
            AND p.empresa_id = p_empresa
            AND p.estado IN ('VIGENTE', 'POR_VENCER')
            AND (p.vence IS NULL OR p.vence >= CURRENT_DATE))
  END
  FROM disposiciones d WHERE d.id = p_disposicion AND d.activo;
$$ LANGUAGE sql STABLE;

-- Versión por id (la usan los dos triggers)
CREATE OR REPLACE FUNCTION fn_decl_autorizacion_check(p_id UUID) RETURNS VOID AS $$
DECLARE d RECORD; sin_cobertura TEXT;
BEGIN
  SELECT * INTO d FROM declaraciones WHERE id = p_id;
  IF NOT FOUND OR d.estado <> 'AUTORIZADA' THEN RETURN; END IF;
  IF NOT EXISTS (SELECT 1 FROM declaracion_sucursales WHERE declaracion_id = d.id) THEN
    RAISE EXCEPTION 'Declaración %: asigne al menos una sede antes de autorizar', d.numero;
  END IF;
  IF d.tipo = 'RESIDUO' AND NOT EXISTS (SELECT 1 FROM declaracion_disposiciones WHERE declaracion_id = d.id) THEN
    RAISE EXCEPTION 'Declaración %: indique la disposición o manejo antes de autorizar', d.numero;
  END IF;
  SELECT string_agg(x.nombre, ', ') INTO sin_cobertura
    FROM declaracion_disposiciones dd JOIN disposiciones x ON x.id = dd.disposicion_id
   WHERE dd.declaracion_id = d.id AND NOT COALESCE(fn_disposicion_cubierta(dd.disposicion_id, d.empresa_id), FALSE);
  IF sin_cobertura IS NOT NULL THEN
    RAISE EXCEPTION 'Declaración %: ningún permiso o licencia vigente cubre: %', d.numero, sin_cobertura;
  END IF;
END $$ LANGUAGE plpgsql;

-- Desde la propia declaración (al crearla o cambiar su estado)
CREATE OR REPLACE FUNCTION fn_decl_autorizacion_desde_decl() RETURNS trigger AS $$
BEGIN
  IF NEW.estado = 'AUTORIZADA' THEN
    PERFORM fn_decl_autorizacion_check(NEW.id);
  END IF;
  RETURN NULL;
END $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION fn_decl_autorizacion_desde_hijo() RETURNS trigger AS $$
BEGIN
  PERFORM fn_decl_autorizacion_check(COALESCE(NEW.declaracion_id, OLD.declaracion_id));
  RETURN NULL;
END $$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER trg_decl_autorizacion
  AFTER INSERT OR UPDATE OF estado ON declaraciones
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION fn_decl_autorizacion_desde_decl();

-- Quitar la última sede o disposición de una declaración autorizada también se bloquea
CREATE CONSTRAINT TRIGGER trg_decl_autorizacion_sedes
  AFTER DELETE ON declaracion_sucursales
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION fn_decl_autorizacion_desde_hijo();

CREATE CONSTRAINT TRIGGER trg_decl_autorizacion_disp
  AFTER INSERT OR DELETE ON declaracion_disposiciones
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION fn_decl_autorizacion_desde_hijo();

-- ---------------------------------------------------------------------
-- 4) Solicitudes: solo declaraciones AUTORIZADAS, ACTIVAS y asignadas a la sede
--    (reemplaza la función de la migración «reglas_negocio»)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_item_declaracion_autorizada() RETURNS trigger AS $$
DECLARE d RECORD; sede UUID;
BEGIN
  SELECT estado, activa, numero INTO d FROM declaraciones WHERE id = NEW.declaracion_id;
  IF d.estado <> 'AUTORIZADA' OR NOT d.activa THEN
    RAISE EXCEPTION 'La declaración % no está autorizada y activa; no se puede programar su recolección', d.numero;
  END IF;
  SELECT sucursal_id INTO sede FROM solicitudes WHERE id = NEW.solicitud_id;
  IF NOT EXISTS (SELECT 1 FROM declaracion_sucursales
                  WHERE declaracion_id = NEW.declaracion_id AND sucursal_id = sede AND activa) THEN
    RAISE EXCEPTION 'La declaración % no está asignada a la sede de la solicitud', d.numero;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------
-- 5) Sedes nuevas: si el cliente tiene declaraciones con alcance TODAS, se suman solas
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_sede_nueva_hereda_todas() RETURNS trigger AS $$
BEGIN
  INSERT INTO declaracion_sucursales (declaracion_id, sucursal_id)
  SELECT id, NEW.id FROM declaraciones WHERE cliente_id = NEW.cliente_id AND alcance_sedes = 'TODAS'
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_sede_nueva_hereda_todas
  AFTER INSERT ON sucursales
  FOR EACH ROW EXECUTE FUNCTION fn_sede_nueva_hereda_todas();
