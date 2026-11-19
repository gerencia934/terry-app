-- Portal de clientes: qué puede ESCRIBIR una sesión del portal (app.cliente_id fijado).
-- La política rls_portal_cliente (migración 20261126000000) ya aísla por cliente. Estas políticas RESTRICTIVE se suman
-- con AND y limitan además qué tipo de escritura hace el cliente, aunque el API tuviera un error. Sin app.cliente_id
-- (personal de Terra Viva, tareas internas) no cambian nada. Una actualización que la política no permite no toca filas;
-- una inserción o un cambio que deje una fila no permitida se rechaza.

-- 1. Solo lectura para el cliente: sus datos comerciales, las tarifas y los documentos de la operación.
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['clientes', 'sucursales', 'tarifas', 'manifiestos', 'manifiesto_items', 'manifiesto_evidencias',
                           'conciliaciones', 'conciliacion_items', 'actas'] LOOP
    EXECUTE format('CREATE POLICY rls_portal_no_inserta ON %I AS RESTRICTIVE FOR INSERT WITH CHECK (fn_rls_cliente() IS NULL)', t);
    EXECUTE format('CREATE POLICY rls_portal_no_modifica ON %I AS RESTRICTIVE FOR UPDATE USING (fn_rls_cliente() IS NULL)', t);
    EXECUTE format('CREATE POLICY rls_portal_no_borra ON %I AS RESTRICTIVE FOR DELETE USING (fn_rls_cliente() IS NULL)', t);
  END LOOP;
END $$;

-- 2. Declaraciones: el cliente las crea en revisión (Terra Viva fija la tarifa y las autoriza) y no las cambia después.
CREATE POLICY rls_portal_decl_inserta ON declaraciones AS RESTRICTIVE FOR INSERT
  WITH CHECK (fn_rls_cliente() IS NULL OR (estado = 'PENDIENTE' AND NOT activa));
CREATE POLICY rls_portal_decl_modifica ON declaraciones AS RESTRICTIVE FOR UPDATE USING (fn_rls_cliente() IS NULL);
CREATE POLICY rls_portal_decl_borra ON declaraciones AS RESTRICTIVE FOR DELETE USING (fn_rls_cliente() IS NULL);
-- Sus sedes, disposiciones, riesgos y etiquetado: solo al crear una declaración que sigue en revisión.
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['declaracion_sucursales', 'declaracion_disposiciones', 'declaracion_riesgos', 'declaracion_etiquetados'] LOOP
    EXECUTE format('CREATE POLICY rls_portal_decl_hijo_inserta ON %I AS RESTRICTIVE FOR INSERT WITH CHECK (fn_rls_cliente() IS NULL
      OR EXISTS (SELECT 1 FROM declaraciones p WHERE p.id = declaracion_id AND p.estado = ''PENDIENTE''))', t);
    EXECUTE format('CREATE POLICY rls_portal_no_modifica ON %I AS RESTRICTIVE FOR UPDATE USING (fn_rls_cliente() IS NULL)', t);
    EXECUTE format('CREATE POLICY rls_portal_no_borra ON %I AS RESTRICTIVE FOR DELETE USING (fn_rls_cliente() IS NULL)', t);
  END LOOP;
END $$;

-- 3. Solicitudes: el cliente las crea pendientes de aprobación y solo cancela las que nadie ha confirmado ni programado.
CREATE POLICY rls_portal_sol_inserta ON solicitudes AS RESTRICTIVE FOR INSERT
  WITH CHECK (fn_rls_cliente() IS NULL OR (clase = 'FORMAL' AND aprobacion = 'PENDIENTE' AND estado = 'PENDIENTE' AND aprobada_por IS NULL));
CREATE POLICY rls_portal_sol_modifica ON solicitudes AS RESTRICTIVE FOR UPDATE
  USING (fn_rls_cliente() IS NULL OR (aprobacion = 'PENDIENTE' AND estado = 'PENDIENTE'))
  WITH CHECK (fn_rls_cliente() IS NULL OR (aprobacion = 'PENDIENTE' AND estado IN ('PENDIENTE', 'CANCELADA')));
CREATE POLICY rls_portal_sol_borra ON solicitudes AS RESTRICTIVE FOR DELETE USING (fn_rls_cliente() IS NULL);
-- Sus líneas: se crean pendientes en una solicitud sin confirmar; solo cambian cuando la base las descarta al cancelarla.
CREATE POLICY rls_portal_item_inserta ON solicitud_items AS RESTRICTIVE FOR INSERT
  WITH CHECK (fn_rls_cliente() IS NULL OR (estado = 'PENDIENTE'
    AND EXISTS (SELECT 1 FROM solicitudes p WHERE p.id = solicitud_id AND p.aprobacion = 'PENDIENTE' AND p.estado = 'PENDIENTE')));
CREATE POLICY rls_portal_item_modifica ON solicitud_items AS RESTRICTIVE FOR UPDATE
  USING (fn_rls_cliente() IS NULL OR estado = 'PENDIENTE')
  WITH CHECK (fn_rls_cliente() IS NULL OR estado IN ('PENDIENTE', 'DESCARTADO'));
CREATE POLICY rls_portal_item_borra ON solicitud_items AS RESTRICTIVE FOR DELETE USING (fn_rls_cliente() IS NULL);

-- 4. Cargues: el cliente registra los suyos (solo de declaraciones). Deshacer uno lo hace la oficina.
CREATE POLICY rls_portal_cargue_inserta ON cargues_masivos AS RESTRICTIVE FOR INSERT
  WITH CHECK (fn_rls_cliente() IS NULL OR (tipo_cargue = 'DECLARACIONES' AND estado = 'CONFIRMADO'));
CREATE POLICY rls_portal_cargue_modifica ON cargues_masivos AS RESTRICTIVE FOR UPDATE USING (fn_rls_cliente() IS NULL);
CREATE POLICY rls_portal_cargue_borra ON cargues_masivos AS RESTRICTIVE FOR DELETE USING (fn_rls_cliente() IS NULL);

-- 5. Usuarios: el administrador del cliente solo crea o cambia usuarios de su empresa, nunca uno de Terra Viva.
CREATE POLICY rls_portal_usuario_inserta ON usuarios AS RESTRICTIVE FOR INSERT
  WITH CHECK (fn_rls_cliente() IS NULL OR cliente_id = fn_rls_cliente());
CREATE POLICY rls_portal_usuario_modifica ON usuarios AS RESTRICTIVE FOR UPDATE
  USING (fn_rls_cliente() IS NULL OR cliente_id = fn_rls_cliente())
  WITH CHECK (fn_rls_cliente() IS NULL OR cliente_id = fn_rls_cliente());
CREATE POLICY rls_portal_usuario_borra ON usuarios AS RESTRICTIVE FOR DELETE USING (fn_rls_cliente() IS NULL);
