-- Portal de clientes: autogestión (20-11-2026, revisión contra el rol «Todos los clientes» de Grinclic).
-- El administrador del cliente ahora también:
--   · crea y edita sus sedes (no las borra: las inactiva; no cambia la principal ni la zona de ruta);
--   · crea sus declaraciones una por una, las corrige (vuelven a revisión, inactivas), retira las que nunca se
--     autorizaron y no tienen uso, e inactiva las autorizadas que ya no genera;
--   · edita sus pedidos mientras nadie los confirma y pide entregas en planta con su propio vehículo.
-- La base sigue limitando qué escribe una sesión del portal (app.cliente_id fijado): estas políticas RESTRICTIVE se
-- suman con AND a rls_portal_cliente (que ya aísla por cliente). Sin app.cliente_id (personal de Terra Viva, tareas
-- internas) nada cambia.

-- 1. Sedes ---------------------------------------------------------------------------------------------------------
DROP POLICY rls_portal_no_inserta ON sucursales;
DROP POLICY rls_portal_no_modifica ON sucursales;
-- (rls_portal_no_borra se conserva: una sede nunca se borra, se inactiva)

CREATE OR REPLACE FUNCTION fn_portal_sede_guarda() RETURNS trigger AS $$
BEGIN
  IF fn_rls_cliente() IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.zona_id IS NOT NULL THEN
      RAISE EXCEPTION 'Desde el portal no se asigna la zona de ruta de una sede: la asigna Terra Viva.';
    END IF;
    IF NOT NEW.activa THEN
      RAISE EXCEPTION 'Una sede nueva queda activa.';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.cliente_id IS DISTINCT FROM OLD.cliente_id OR NEW.es_principal IS DISTINCT FROM OLD.es_principal
     OR NEW.zona_id IS DISTINCT FROM OLD.zona_id THEN
    RAISE EXCEPTION 'Desde el portal no se cambia la sede principal ni la zona de ruta: pídaselo a Terra Viva.';
  END IF;
  IF OLD.es_principal AND NOT NEW.activa THEN
    RAISE EXCEPTION 'La sede principal no se inactiva.';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_portal_sede_guarda BEFORE INSERT OR UPDATE ON sucursales FOR EACH ROW EXECUTE FUNCTION fn_portal_sede_guarda();

-- Una sede nueva hereda las declaraciones del cliente con alcance «todas las sedes» (regla de 20261119000100). También
-- cuando la crea el cliente: ese vínculo se permite aunque la declaración ya esté autorizada (Terra Viva la autorizó para
-- todas sus sedes y cada pedido igual pasa por su confirmación). Las anuladas no se heredan (antes hacían fallar la sede).
CREATE OR REPLACE FUNCTION fn_sede_nueva_hereda_todas() RETURNS trigger AS $$
BEGIN
  INSERT INTO declaracion_sucursales (declaracion_id, sucursal_id)
  SELECT id, NEW.id FROM declaraciones WHERE cliente_id = NEW.cliente_id AND alcance_sedes = 'TODAS' AND estado <> 'ANULADA'
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP POLICY rls_portal_decl_hijo_inserta ON declaracion_sucursales;
CREATE POLICY rls_portal_decl_hijo_inserta ON declaracion_sucursales AS RESTRICTIVE FOR INSERT WITH CHECK (fn_rls_cliente() IS NULL
  OR EXISTS (SELECT 1 FROM declaraciones p WHERE p.id = declaracion_id AND (p.estado = 'PENDIENTE' OR p.alcance_sedes = 'TODAS')));

-- Al inactivar una sede, sus vínculos con declaraciones se inactivan. Desde el portal nunca se activan.
DROP POLICY rls_portal_no_modifica ON declaracion_sucursales;
CREATE POLICY rls_portal_decl_sede_modifica ON declaracion_sucursales AS RESTRICTIVE FOR UPDATE
  USING (TRUE) WITH CHECK (fn_rls_cliente() IS NULL OR NOT activa);

-- 2. Declaraciones -------------------------------------------------------------------------------------------------
-- Después de cualquier cambio del portal la declaración queda inactiva: en revisión (corregida), autorizada pero
-- inactiva (ya no la genera) o anulada (retirada antes de autorizarse). Nunca la autoriza ni la activa.
DROP POLICY rls_portal_decl_modifica ON declaraciones;
CREATE POLICY rls_portal_decl_modifica ON declaraciones AS RESTRICTIVE FOR UPDATE
  USING (fn_rls_cliente() IS NULL OR estado <> 'ANULADA')
  WITH CHECK (fn_rls_cliente() IS NULL OR (NOT activa AND estado IN ('PENDIENTE', 'AUTORIZADA', 'ANULADA')));

CREATE OR REPLACE FUNCTION fn_portal_decl_guarda() RETURNS trigger AS $$
DECLARE libres TEXT[] := ARRAY['activa', 'causal_id', 'observaciones', 'updated_at'];
BEGIN
  IF fn_rls_cliente() IS NULL THEN RETURN NEW; END IF;
  IF NEW.cliente_id IS DISTINCT FROM OLD.cliente_id OR NEW.empresa_id IS DISTINCT FROM OLD.empresa_id OR NEW.tipo IS DISTINCT FROM OLD.tipo
     OR NEW.mostrar_precio_app IS DISTINCT FROM OLD.mostrar_precio_app OR NEW.solicitud_automatica IS DISTINCT FROM OLD.solicitud_automatica
     OR NEW.cargue_id IS DISTINCT FROM OLD.cargue_id THEN
    RAISE EXCEPTION 'Desde el portal no se cambia el cliente, el tipo, el precio ni la programación automática de una declaración.';
  END IF;
  -- Autorizada: el cliente solo la inactiva. Cualquier otro cambio la devuelve a revisión (estado PENDIENTE).
  IF NEW.estado = 'AUTORIZADA' AND (OLD.estado <> 'AUTORIZADA' OR (to_jsonb(NEW) - libres) <> (to_jsonb(OLD) - libres)) THEN
    RAISE EXCEPTION 'Una declaración autorizada solo se inactiva desde el portal: al corregirla vuelve a revisión.';
  END IF;
  -- Retirarla (anularla) solo antes de que Terra Viva la autorice (y sin uso: lo exige fn_decl_anulada)
  IF NEW.estado = 'ANULADA' AND OLD.estado NOT IN ('BORRADOR', 'PENDIENTE', 'RECHAZADA') THEN
    RAISE EXCEPTION 'Solo se retira una declaración que Terra Viva aún no ha autorizado: una autorizada se inactiva.';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_portal_decl_guarda BEFORE UPDATE ON declaraciones FOR EACH ROW EXECUTE FUNCTION fn_portal_decl_guarda();

-- Al corregir una declaración (ya de vuelta en revisión) se cambian sus sedes, disposiciones, riesgos y etiquetado.
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['declaracion_sucursales', 'declaracion_disposiciones', 'declaracion_riesgos', 'declaracion_etiquetados'] LOOP
    EXECUTE format('DROP POLICY rls_portal_no_borra ON %I', t);
    EXECUTE format('CREATE POLICY rls_portal_decl_hijo_borra ON %I AS RESTRICTIVE FOR DELETE USING (fn_rls_cliente() IS NULL
      OR EXISTS (SELECT 1 FROM declaraciones p WHERE p.id = declaracion_id AND p.estado = ''PENDIENTE''))', t);
  END LOOP;
END $$;
DROP POLICY rls_portal_no_modifica ON declaracion_disposiciones;
CREATE POLICY rls_portal_decl_hijo_modifica ON declaracion_disposiciones AS RESTRICTIVE FOR UPDATE
  USING (fn_rls_cliente() IS NULL OR EXISTS (SELECT 1 FROM declaraciones p WHERE p.id = declaracion_id AND p.estado = 'PENDIENTE'));

-- 3. Solicitudes ---------------------------------------------------------------------------------------------------
-- Editar un pedido sin confirmar cambia sus líneas: se crean las nuevas y se quitan las que ya no van.
DROP POLICY rls_portal_item_borra ON solicitud_items;
CREATE POLICY rls_portal_item_borra ON solicitud_items AS RESTRICTIVE FOR DELETE
  USING (fn_rls_cliente() IS NULL OR (estado = 'PENDIENTE'
    AND EXISTS (SELECT 1 FROM solicitudes p WHERE p.id = solicitud_id AND p.aprobacion = 'PENDIENTE' AND p.estado = 'PENDIENTE')));

-- Especificaciones adicionales de cada línea (registro fotográfico, devolución de recipiente…): también aisladas por
-- cliente; el portal solo las pone o las quita en un pedido que nadie ha confirmado.
ALTER TABLE solicitud_item_especificaciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE solicitud_item_especificaciones FORCE ROW LEVEL SECURITY;
CREATE POLICY rls_portal_cliente ON solicitud_item_especificaciones USING (fn_rls_cliente() IS NULL OR EXISTS (
  SELECT 1 FROM solicitud_items i JOIN solicitudes p ON p.id = i.solicitud_id WHERE i.id = solicitud_item_especificaciones.solicitud_item_id AND p.cliente_id = fn_rls_cliente()));
CREATE POLICY rls_portal_esp_inserta ON solicitud_item_especificaciones AS RESTRICTIVE FOR INSERT WITH CHECK (fn_rls_cliente() IS NULL OR EXISTS (
  SELECT 1 FROM solicitud_items i JOIN solicitudes p ON p.id = i.solicitud_id
   WHERE i.id = solicitud_item_especificaciones.solicitud_item_id AND i.estado = 'PENDIENTE' AND p.aprobacion = 'PENDIENTE' AND p.estado = 'PENDIENTE'));
CREATE POLICY rls_portal_esp_modifica ON solicitud_item_especificaciones AS RESTRICTIVE FOR UPDATE USING (fn_rls_cliente() IS NULL);
CREATE POLICY rls_portal_esp_borra ON solicitud_item_especificaciones AS RESTRICTIVE FOR DELETE USING (fn_rls_cliente() IS NULL OR EXISTS (
  SELECT 1 FROM solicitud_items i JOIN solicitudes p ON p.id = i.solicitud_id
   WHERE i.id = solicitud_item_especificaciones.solicitud_item_id AND i.estado = 'PENDIENTE' AND p.aprobacion = 'PENDIENTE' AND p.estado = 'PENDIENTE'));

-- Vehículo y tripulación de terceros (entregas en planta): tienen cédulas, ARL y EPS. El portal solo ve los de sus
-- propios pedidos y manifiestos; los registra al pedir una entrega y no los cambia después.
ALTER TABLE transportes_terceros ENABLE ROW LEVEL SECURITY;
ALTER TABLE transportes_terceros FORCE ROW LEVEL SECURITY;
CREATE POLICY rls_portal_cliente ON transportes_terceros USING (fn_rls_cliente() IS NULL
  OR EXISTS (SELECT 1 FROM solicitudes s WHERE s.transporte_id = transportes_terceros.id AND s.cliente_id = fn_rls_cliente())
  OR EXISTS (SELECT 1 FROM manifiestos m WHERE m.transporte_id = transportes_terceros.id AND m.cliente_id = fn_rls_cliente()));
-- Al registrarlo aún no hay pedido que lo use: el portal lo inserta (sin leerlo de vuelta) y luego lo enlaza.
CREATE POLICY rls_portal_transporte_inserta ON transportes_terceros FOR INSERT WITH CHECK (TRUE);
CREATE POLICY rls_portal_transporte_modifica ON transportes_terceros AS RESTRICTIVE FOR UPDATE USING (fn_rls_cliente() IS NULL);
CREATE POLICY rls_portal_transporte_borra ON transportes_terceros AS RESTRICTIVE FOR DELETE USING (fn_rls_cliente() IS NULL);

-- Una entrega en planta del portal va a una planta propia de Terra Viva (proveedor propio marcado como destino) y con
-- el vehículo que la lleva. Al editar un pedido el portal no cambia su tipo, su cliente ni su aprobación.
CREATE OR REPLACE FUNCTION fn_portal_sol_guarda() RETURNS trigger AS $$
BEGIN
  IF fn_rls_cliente() IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' AND NEW.operacion = 'DESCARGA' AND (NEW.destino_id IS NULL OR NEW.transporte_id IS NULL) THEN
    RAISE EXCEPTION 'Una entrega en planta indica la planta y el vehículo que la lleva.';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.operacion IS DISTINCT FROM OLD.operacion OR NEW.clase IS DISTINCT FROM OLD.clase
     OR NEW.cliente_id IS DISTINCT FROM OLD.cliente_id OR NEW.aprobada_por IS DISTINCT FROM OLD.aprobada_por) THEN
    RAISE EXCEPTION 'Desde el portal no se cambia el tipo, el cliente ni la aprobación de un pedido.';
  END IF;
  IF NEW.destino_id IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.destino_id IS DISTINCT FROM OLD.destino_id)
     AND NOT EXISTS (SELECT 1 FROM proveedores WHERE id = NEW.destino_id AND empresa_id = NEW.empresa_id AND es_destino AND es_propio AND activo) THEN
    RAISE EXCEPTION 'La entrega en planta va a una planta de Terra Viva.';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_portal_sol_guarda BEFORE INSERT OR UPDATE ON solicitudes FOR EACH ROW EXECUTE FUNCTION fn_portal_sol_guarda();
