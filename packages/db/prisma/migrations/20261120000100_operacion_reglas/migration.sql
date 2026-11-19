-- =====================================================================
-- TERRY-GO · Fase 3-A — Reglas de la cadena operativa en la base de datos.
-- Ninguna pantalla, API, app sin señal ni cargue masivo puede saltárselas.
--   1) Consecutivos de documentos
--   2) Solicitudes: validez de las líneas y estado calculado
--   3) Programación por línea (ruta_items) y rutas
--   4) Rastreo GPS solo en etapas con rastreo
--   5) Manifiestos: grabar (REALIZADO), anular y bloqueo después del cierre
--   6) Conciliación: aprobar y bloqueo después de aprobar (salvo cartera)
--   7) Actas: solo líneas aprobadas; emitir y anular
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Consecutivos: «prefijo-AAAA-00001» (formato provisional hasta que Terra Viva lo defina:
--    se cambia en la tabla consecutivos, sin tocar código).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_siguiente_consecutivo(p_empresa UUID, p_documento TEXT) RETURNS TEXT AS $$
DECLARE c consecutivos; anio_actual INT := EXTRACT(YEAR FROM (now() AT TIME ZONE 'America/Bogota'))::INT;
BEGIN
  INSERT INTO consecutivos (empresa_id, documento, prefijo, anio)
  VALUES (p_empresa, p_documento, CASE p_documento WHEN 'MANIFIESTO' THEN 'MF-' WHEN 'INSPECCION' THEN 'INS-' WHEN 'ACTA' THEN 'ACT-' ELSE '' END, anio_actual)
  ON CONFLICT (empresa_id, documento) DO NOTHING;
  -- La fila queda bloqueada hasta el fin de la transacción: no hay números repetidos ni saltos por concurrencia.
  UPDATE consecutivos
     SET ultimo = CASE WHEN reinicio_anual AND anio <> anio_actual THEN 1 ELSE ultimo + 1 END,
         anio = CASE WHEN reinicio_anual THEN anio_actual ELSE anio END
   WHERE empresa_id = p_empresa AND documento = p_documento
  RETURNING * INTO c;
  RETURN c.prefijo || CASE WHEN c.reinicio_anual THEN c.anio || '-' ELSE '' END || lpad(c.ultimo::TEXT, c.digitos, '0');
END $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION fn_asignar_consecutivo() RETURNS trigger AS $$
DECLARE emp UUID;
BEGIN
  IF COALESCE(NEW.numero, '') <> '' THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME = 'preoperacionales' THEN
    SELECT empresa_id INTO emp FROM vehiculos WHERE id = NEW.vehiculo_id;
  ELSE
    emp := NEW.empresa_id;
  END IF;
  NEW.numero := fn_siguiente_consecutivo(emp, TG_ARGV[0]);
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_consecutivo_manifiesto BEFORE INSERT ON manifiestos FOR EACH ROW EXECUTE FUNCTION fn_asignar_consecutivo('MANIFIESTO');
CREATE TRIGGER trg_consecutivo_acta BEFORE INSERT ON actas FOR EACH ROW EXECUTE FUNCTION fn_asignar_consecutivo('ACTA');
CREATE TRIGGER trg_consecutivo_inspeccion BEFORE INSERT ON preoperacionales FOR EACH ROW EXECUTE FUNCTION fn_asignar_consecutivo('INSPECCION');

-- Conversión: las inspecciones anteriores reciben su número en orden de fecha
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT p.id, v.empresa_id FROM preoperacionales p JOIN vehiculos v ON v.id = p.vehiculo_id
            WHERE p.numero = '' ORDER BY p.fecha_programada, p.fecha_real NULLS LAST, p.id
  LOOP
    UPDATE preoperacionales SET numero = fn_siguiente_consecutivo(r.empresa_id, 'INSPECCION') WHERE id = r.id;
  END LOOP;
END $$;
CREATE UNIQUE INDEX ux_preoperacional_numero ON preoperacionales (vehiculo_id, numero); -- único dentro de la empresa vía vehículo

-- ---------------------------------------------------------------------
-- 2) Solicitudes
-- ---------------------------------------------------------------------
-- Una línea (de solicitud o de manifiesto) solo con declaración AUTORIZADA, ACTIVA, del mismo
-- cliente y asignada a la sede de la línea. Reemplaza la versión de «declaraciones_reglas».
CREATE OR REPLACE FUNCTION fn_item_declaracion_autorizada() RETURNS trigger AS $$
DECLARE d RECORD; cliente UUID;
BEGIN
  SELECT estado, activa, numero, cliente_id INTO d FROM declaraciones WHERE id = NEW.declaracion_id;
  IF d.estado <> 'AUTORIZADA' OR NOT d.activa THEN
    RAISE EXCEPTION 'La declaración % no está autorizada y activa; no se puede programar su recolección', d.numero;
  END IF;
  IF TG_TABLE_NAME = 'solicitud_items' THEN
    SELECT cliente_id INTO cliente FROM solicitudes WHERE id = NEW.solicitud_id;
  ELSE
    SELECT cliente_id INTO cliente FROM manifiestos WHERE id = NEW.manifiesto_id;
  END IF;
  IF d.cliente_id <> cliente THEN
    RAISE EXCEPTION 'La declaración % es de otro cliente', d.numero;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM declaracion_sucursales
                  WHERE declaracion_id = NEW.declaracion_id AND sucursal_id = NEW.sucursal_id AND activa) THEN
    RAISE EXCEPTION 'La declaración % no está asignada a esa sede', d.numero;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_item_declaracion_autorizada ON solicitud_items;
CREATE TRIGGER trg_item_declaracion_autorizada
  BEFORE INSERT OR UPDATE OF declaracion_id, sucursal_id ON solicitud_items
  FOR EACH ROW EXECUTE FUNCTION fn_item_declaracion_autorizada();

ALTER TABLE solicitud_items
  ADD CONSTRAINT chk_item_cantidad CHECK (cantidad_estimada IS NULL OR cantidad_estimada > 0),
  -- NOT VALID: las líneas descartadas de la fase 1 pueden no tener causal
  ADD CONSTRAINT chk_item_descarte_causal CHECK (estado <> 'DESCARTADO' OR causal_descarte_id IS NOT NULL) NOT VALID;

ALTER TABLE solicitudes
  ADD CONSTRAINT chk_sol_aprobada CHECK (aprobacion <> 'APROBADA' OR aprobada_en IS NOT NULL),
  ADD CONSTRAINT chk_sol_cancelada CHECK (estado <> 'CANCELADA' OR causal_cancelacion_id IS NOT NULL) NOT VALID,
  ADD CONSTRAINT chk_sol_pre_activacion CHECK (clase <> 'PRE' OR fecha_activacion IS NOT NULL) NOT VALID;

-- El estado de la solicitud se calcula a partir de sus líneas (salvo CANCELADA, que es manual).
CREATE OR REPLACE FUNCTION fn_solicitud_recalcular(p_solicitud UUID) RETURNS VOID AS $$
DECLARE pend INT; prog INT; real INT; desc_ INT; total INT;
BEGIN
  SELECT count(*) FILTER (WHERE estado = 'PENDIENTE'), count(*) FILTER (WHERE estado = 'PROGRAMADO'),
         count(*) FILTER (WHERE estado = 'REALIZADO'), count(*) FILTER (WHERE estado = 'DESCARTADO'), count(*)
    INTO pend, prog, real, desc_, total
    FROM solicitud_items WHERE solicitud_id = p_solicitud;
  UPDATE solicitudes SET estado = CASE
      WHEN total = 0 THEN 'PENDIENTE'
      WHEN real > 0 AND pend = 0 AND prog = 0 THEN 'RECOLECTADA'
      WHEN prog > 0 AND pend = 0 THEN 'PROGRAMADA'
      ELSE 'PENDIENTE' END::"EstadoSolicitud"
   WHERE id = p_solicitud AND estado <> 'CANCELADA';
END $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION fn_item_recalcular_solicitud() RETURNS trigger AS $$
BEGIN
  PERFORM fn_solicitud_recalcular(COALESCE(NEW.solicitud_id, OLD.solicitud_id));
  RETURN NULL;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_item_recalcular_solicitud
  AFTER INSERT OR DELETE OR UPDATE OF estado ON solicitud_items
  FOR EACH ROW EXECUTE FUNCTION fn_item_recalcular_solicitud();

-- Cancelar la solicitud descarta sus líneas sin programar; no se cancela si ya tiene líneas en ruta o realizadas.
CREATE OR REPLACE FUNCTION fn_solicitud_cancelar() RETURNS trigger AS $$
BEGIN
  IF NEW.estado = 'CANCELADA' AND OLD.estado <> 'CANCELADA' THEN
    IF EXISTS (SELECT 1 FROM solicitud_items WHERE solicitud_id = NEW.id AND estado IN ('PROGRAMADO', 'REALIZADO')) THEN
      RAISE EXCEPTION 'La solicitud % tiene líneas programadas o realizadas: quítelas de la ruta antes de cancelarla', NEW.numero;
    END IF;
    UPDATE solicitud_items SET estado = 'DESCARTADO', causal_descarte_id = COALESCE(causal_descarte_id, NEW.causal_cancelacion_id)
     WHERE solicitud_id = NEW.id AND estado = 'PENDIENTE';
  END IF;
  RETURN NULL;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_solicitud_cancelar AFTER UPDATE OF estado ON solicitudes
  FOR EACH ROW EXECUTE FUNCTION fn_solicitud_cancelar();

-- ---------------------------------------------------------------------
-- 3) Programación por línea y rutas
-- ---------------------------------------------------------------------
-- Una línea solo puede estar en una ruta vigente a la vez
CREATE UNIQUE INDEX ux_ruta_item_vigente ON ruta_items (solicitud_item_id) WHERE NOT liberado;
CREATE UNIQUE INDEX ux_ruta_parada_item ON ruta_items (parada_id, solicitud_item_id) WHERE NOT liberado;

CREATE OR REPLACE FUNCTION fn_ruta_item_valido() RETURNS trigger AS $$
DECLARE i RECORD; s RECORD; r RECORD; p RECORD; e RECORD;
BEGIN
  IF NEW.liberado THEN RETURN NEW; END IF;
  SELECT * INTO i FROM solicitud_items WHERE id = NEW.solicitud_item_id;
  SELECT * INTO s FROM solicitudes WHERE id = i.solicitud_id;
  SELECT * INTO r FROM rutas WHERE id = NEW.ruta_id;
  SELECT * INTO p FROM ruta_paradas WHERE id = NEW.parada_id;
  SELECT * INTO e FROM estados_recorrido WHERE id = r.estado_recorrido_id;
  IF s.empresa_id <> r.empresa_id THEN RAISE EXCEPTION 'La solicitud % es de otra empresa', s.numero; END IF;
  IF s.aprobacion <> 'APROBADA' OR s.clase <> 'FORMAL' OR s.estado = 'CANCELADA' THEN
    RAISE EXCEPTION 'La solicitud % no está aprobada (o es recurrente sin activar): no se puede programar', s.numero;
  END IF;
  IF s.operacion <> 'CARGA' THEN RAISE EXCEPTION 'La solicitud % es de descarga en planta: no lleva ruta', s.numero; END IF;
  IF i.estado <> 'PENDIENTE' THEN RAISE EXCEPTION 'Una línea de la solicitud % ya está programada, realizada o descartada', s.numero; END IF;
  IF p.ruta_id <> NEW.ruta_id OR p.sucursal_id <> i.sucursal_id THEN
    RAISE EXCEPTION 'La línea de la solicitud % no es de la sede de esa parada', s.numero;
  END IF;
  IF COALESCE(e.es_final, false) THEN RAISE EXCEPTION 'La ruta % ya terminó o fue cancelada', r.codigo; END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_ruta_item_valido BEFORE INSERT OR UPDATE OF solicitud_item_id, parada_id, liberado ON ruta_items
  FOR EACH ROW EXECUTE FUNCTION fn_ruta_item_valido();

-- La línea pasa a PROGRAMADO al entrar a la ruta y vuelve a PENDIENTE al liberarse (si no se realizó)
CREATE OR REPLACE FUNCTION fn_ruta_item_estado() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NOT NEW.liberado THEN
    UPDATE solicitud_items SET estado = 'PROGRAMADO' WHERE id = NEW.solicitud_item_id;
  ELSIF (TG_OP = 'UPDATE' AND NEW.liberado AND NOT OLD.liberado) OR (TG_OP = 'DELETE' AND NOT OLD.liberado) THEN
    UPDATE solicitud_items SET estado = 'PENDIENTE' WHERE id = OLD.solicitud_item_id AND estado = 'PROGRAMADO';
  END IF;
  RETURN NULL;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_ruta_item_estado AFTER INSERT OR DELETE OR UPDATE OF liberado ON ruta_items
  FOR EACH ROW EXECUTE FUNCTION fn_ruta_item_estado();

ALTER TABLE rutas
  ADD CONSTRAINT chk_ruta_frecuencia CHECK (frecuencia_dias IS NULL OR frecuencia_dias BETWEEN 1 AND 366),
  ADD CONSTRAINT chk_ruta_recurrente CHECK (NOT recurrente_activa OR frecuencia_dias IS NOT NULL),
  ADD CONSTRAINT chk_ruta_flete CHECK (valor_flete IS NULL OR valor_flete >= 0),
  ADD CONSTRAINT chk_ruta_km CHECK (km_inicial IS NULL OR km_final IS NULL OR km_final >= km_inicial) NOT VALID;

-- Salir de la etapa inicial exige vehículo, conductor e inspección aprobada (reemplaza la versión de la fase 1).
-- Las etapas finales (finalizada, cancelada) no se bloquean: cancelar siempre debe ser posible.
CREATE OR REPLACE FUNCTION fn_bloqueo_preoperacional() RETURNS trigger AS $$
DECLARE orden_estado INT; final_estado BOOLEAN;
BEGIN
  SELECT orden, es_final INTO orden_estado, final_estado FROM estados_recorrido WHERE id = NEW.estado_recorrido_id;
  IF orden_estado IS NOT NULL AND orden_estado > 1 AND NOT final_estado THEN
    IF NEW.vehiculo_id IS NULL OR NEW.conductor_id IS NULL THEN
      RAISE EXCEPTION 'La ruta % no puede salir: asigne vehículo y conductor', NEW.codigo;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM preoperacionales p
                    WHERE p.vehiculo_id = NEW.vehiculo_id AND p.fecha_programada = NEW.fecha_programada AND p.aprobado IS TRUE) THEN
      RAISE EXCEPTION 'La ruta % no puede salir: preoperacional del vehículo sin aprobar', NEW.codigo;
    END IF;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

-- Al entrar a una etapa que cancela, se liberan las líneas que no se alcanzaron a recoger
CREATE OR REPLACE FUNCTION fn_ruta_cancelar() RETURNS trigger AS $$
BEGIN
  IF NEW.estado_recorrido_id IS DISTINCT FROM OLD.estado_recorrido_id
     AND EXISTS (SELECT 1 FROM estados_recorrido WHERE id = NEW.estado_recorrido_id AND cancela) THEN
    UPDATE ruta_items ri SET liberado = true
      FROM solicitud_items si
     WHERE ri.ruta_id = NEW.id AND NOT ri.liberado AND si.id = ri.solicitud_item_id AND si.estado = 'PROGRAMADO';
  END IF;
  RETURN NULL;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_ruta_cancelar AFTER UPDATE OF estado_recorrido_id ON rutas
  FOR EACH ROW EXECUTE FUNCTION fn_ruta_cancelar();

-- ---------------------------------------------------------------------
-- 4) Rastreo GPS: solo mientras la ruta está en una etapa con rastreo (Ley 1581 de 2012)
-- ---------------------------------------------------------------------
ALTER TABLE ruta_rastreo
  ADD CONSTRAINT chk_rastreo_coordenadas CHECK (latitud BETWEEN -5 AND 14 AND longitud BETWEEN -82 AND -66);

CREATE OR REPLACE FUNCTION fn_rastreo_permitido() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM rutas r JOIN estados_recorrido e ON e.id = r.estado_recorrido_id
                  WHERE r.id = NEW.ruta_id AND e.rastreo) THEN
    RAISE EXCEPTION 'La ruta no está en una etapa con rastreo: no se registra la ubicación';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_rastreo_permitido BEFORE INSERT ON ruta_rastreo
  FOR EACH ROW EXECUTE FUNCTION fn_rastreo_permitido();

-- ---------------------------------------------------------------------
-- 5) Manifiestos
-- ---------------------------------------------------------------------
ALTER TABLE manifiestos
  ADD CONSTRAINT chk_mf_pesos CHECK (COALESCE(peso_entrada, 0) >= 0 AND COALESCE(peso_salida, 0) >= 0 AND COALESCE(peso_neto, 0) >= 0),
  ADD CONSTRAINT chk_mf_peso_neto CHECK (peso_entrada IS NULL OR peso_salida IS NULL OR peso_neto IS NULL
                                         OR peso_neto = peso_entrada - peso_salida),
  ADD CONSTRAINT chk_mf_horas CHECK (hora_llegada IS NULL OR hora_salida IS NULL OR hora_salida >= hora_llegada),
  ADD CONSTRAINT chk_mf_descargue_sin_ruta CHECK (tipo <> 'DESCARGUE' OR ruta_id IS NULL),
  ADD CONSTRAINT chk_mf_anulado CHECK (estado <> 'ANULADO' OR causal_anulacion_id IS NOT NULL
                                       OR COALESCE(LENGTH(TRIM(motivo_anulacion)), 0) > 0);

ALTER TABLE manifiesto_items
  ADD CONSTRAINT chk_mf_item_cantidad CHECK (cantidad_origen > 0),
  ADD CONSTRAINT chk_mf_item_precio CHECK (precio_unitario IS NULL OR precio_unitario >= 0);

-- Transiciones: PENDIENTE → REALIZADO (grabar) · PENDIENTE/REALIZADO → ANULADO. Nada más.
CREATE OR REPLACE FUNCTION fn_manifiesto_transicion() RETURNS trigger AS $$
DECLARE t RECORD; faltan TEXT[] := '{}';
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.estado <> 'PENDIENTE' THEN RAISE EXCEPTION 'Un manifiesto se crea pendiente y se graba después'; END IF;
    RETURN NEW;
  END IF;
  IF OLD.estado = 'ANULADO' THEN RAISE EXCEPTION 'El manifiesto % está anulado: no se puede modificar', OLD.numero; END IF;

  IF NEW.estado = OLD.estado THEN
    -- Ya grabado: solo se pueden completar el PDF y el consecutivo RNDC
    IF OLD.estado = 'REALIZADO' AND (
         NEW.cliente_id, NEW.destino_id, NEW.tipo, NEW.ruta_id, NEW.fecha_servicio, NEW.peso_entrada, NEW.peso_salida, NEW.peso_neto,
         NEW.hora_llegada, NEW.hora_salida, NEW.firma_url, NEW.firma_nombre, NEW.firma_documento, NEW.transporte_id,
         NEW.vehiculo_id, NEW.conductor_id, NEW.tipo_conciliacion)
       IS DISTINCT FROM (
         OLD.cliente_id, OLD.destino_id, OLD.tipo, OLD.ruta_id, OLD.fecha_servicio, OLD.peso_entrada, OLD.peso_salida, OLD.peso_neto,
         OLD.hora_llegada, OLD.hora_salida, OLD.firma_url, OLD.firma_nombre, OLD.firma_documento, OLD.transporte_id,
         OLD.vehiculo_id, OLD.conductor_id, OLD.tipo_conciliacion) THEN
      RAISE EXCEPTION 'El manifiesto % ya fue grabado: no se puede modificar (anúlelo si hay un error)', OLD.numero;
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.estado = 'REALIZADO' THEN
    IF OLD.estado <> 'PENDIENTE' THEN RAISE EXCEPTION 'Transición de estado no permitida'; END IF;
    IF COALESCE(NEW.firma_url, '') = '' THEN faltan := array_append(faltan, 'la firma del conductor'); END IF;
    IF COALESCE(TRIM(NEW.firma_nombre), '') = '' THEN faltan := array_append(faltan, 'el nombre de quien firma'); END IF;
    IF COALESCE(TRIM(NEW.firma_documento), '') = '' THEN faltan := array_append(faltan, 'la identificación de quien firma'); END IF;
    IF NEW.hora_llegada IS NULL THEN faltan := array_append(faltan, 'la hora de llegada'); END IF;
    IF NEW.hora_salida IS NULL THEN faltan := array_append(faltan, 'la hora de salida'); END IF;
    IF NOT EXISTS (SELECT 1 FROM manifiesto_items WHERE manifiesto_id = NEW.id) THEN faltan := array_append(faltan, 'al menos una línea'); END IF;
    IF NEW.tipo = 'DESCARGUE' THEN
      IF NEW.peso_neto IS NULL THEN faltan := array_append(faltan, 'el peso neto de báscula'); END IF;
      SELECT * INTO t FROM transportes_terceros WHERE id = NEW.transporte_id;
      IF NOT FOUND THEN faltan := array_append(faltan, 'los datos del transportador');
      ELSE
        IF COALESCE(TRIM(t.conductor_nombre), '') = '' OR COALESCE(TRIM(t.conductor_documento), '') = '' THEN
          faltan := array_append(faltan, 'nombre e identificación del conductor'); END IF;
        IF t.conductor_arl_id IS NULL OR t.conductor_eps_id IS NULL THEN faltan := array_append(faltan, 'ARL y EPS del conductor'); END IF;
        IF COALESCE(TRIM(t.auxiliar_nombre), '') <> '' AND (t.auxiliar_arl_id IS NULL OR t.auxiliar_eps_id IS NULL) THEN
          faltan := array_append(faltan, 'ARL y EPS del auxiliar'); END IF;
      END IF;
    ELSE
      IF NEW.vehiculo_id IS NULL OR NEW.conductor_id IS NULL THEN faltan := array_append(faltan, 'vehículo y conductor'); END IF;
    END IF;
    IF cardinality(faltan) > 0 THEN
      RAISE EXCEPTION 'No se puede grabar el manifiesto %: falta %', NEW.numero, array_to_string(faltan, ', ');
    END IF;
    NEW.realizado_en := COALESCE(NEW.realizado_en, now());
    RETURN NEW;
  END IF;

  IF NEW.estado = 'ANULADO' THEN
    IF EXISTS (SELECT 1 FROM conciliaciones WHERE manifiesto_id = NEW.id AND estado = 'APROBADA') THEN
      RAISE EXCEPTION 'El manifiesto % tiene la conciliación aprobada: no se puede anular', NEW.numero;
    END IF;
    NEW.anulado_en := COALESCE(NEW.anulado_en, now());
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Transición de estado no permitida (% → %)', OLD.estado, NEW.estado;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_manifiesto_transicion BEFORE INSERT OR UPDATE ON manifiestos
  FOR EACH ROW EXECUTE FUNCTION fn_manifiesto_transicion();

-- Efectos de grabar y de anular
CREATE OR REPLACE FUNCTION fn_manifiesto_efectos() RETURNS trigger AS $$
DECLARE conc UUID; x RECORD; sol UUID;
BEGIN
  IF NEW.estado = OLD.estado THEN RETURN NULL; END IF;

  IF NEW.estado = 'REALIZADO' THEN
    -- a) las líneas de solicitud recogidas quedan realizadas, con la cantidad del manifiesto
    UPDATE solicitud_items si SET estado = 'REALIZADO', cantidad_real = mi.cantidad_origen
      FROM manifiesto_items mi WHERE mi.manifiesto_id = NEW.id AND si.id = mi.solicitud_item_id;
    -- b) se abre la conciliación en borrador con la cantidad cargada, el precio y la negociación del cliente
    INSERT INTO conciliaciones (id, empresa_id, manifiesto_id) VALUES (gen_random_uuid(), NEW.empresa_id, NEW.id)
      RETURNING id INTO conc;
    INSERT INTO conciliacion_items (id, conciliacion_id, manifiesto_item_id, cantidad_origen, metrica_id, precio_unitario,
                                    tipo_negociacion, forma_pago, disposicion_id, orden_compra)
    SELECT gen_random_uuid(), conc, mi.id, mi.cantidad_origen, mi.metrica_id, mi.precio_unitario,
           cl.tipo_negociacion, cl.forma_pago, mi.disposicion_id, NEW.orden_compra
      FROM manifiesto_items mi JOIN clientes cl ON cl.id = NEW.cliente_id
     WHERE mi.manifiesto_id = NEW.id;
    -- c) solicitud recurrente (clase PRE) por cada declaración con solicitud automática
    FOR x IN SELECT DISTINCT ON (d.id) d.id AS declaracion_id, mi.sucursal_id, d.frecuencia_dias, d.cantidad_frecuencia
               FROM manifiesto_items mi JOIN declaraciones d ON d.id = mi.declaracion_id
              WHERE mi.manifiesto_id = NEW.id AND NEW.tipo = 'CARGUE'
                AND d.solicitud_automatica AND d.frecuencia_dias IS NOT NULL AND d.estado = 'AUTORIZADA' AND d.activa
                AND EXISTS (SELECT 1 FROM declaracion_sucursales ds WHERE ds.declaracion_id = d.id AND ds.sucursal_id = mi.sucursal_id AND ds.activa)
              ORDER BY d.id, mi.id
    LOOP
      INSERT INTO solicitudes (id, empresa_id, clase, operacion, cliente_id, fecha_solicitada, fecha_activacion, manifiesto_origen_id, creado_por)
      VALUES (gen_random_uuid(), NEW.empresa_id, 'PRE', 'CARGA', NEW.cliente_id, NEW.fecha_servicio + x.frecuencia_dias,
              NEW.fecha_servicio + GREATEST(x.frecuencia_dias - 3, 0), NEW.id, NEW.realizado_por)
      RETURNING id INTO sol;
      INSERT INTO solicitud_items (id, solicitud_id, declaracion_id, sucursal_id, cantidad_estimada)
      VALUES (gen_random_uuid(), sol, x.declaracion_id, x.sucursal_id, x.cantidad_frecuencia);
    END LOOP;

  ELSIF NEW.estado = 'ANULADO' THEN
    -- a) se borra la conciliación (en borrador: la aprobada impide anular)
    DELETE FROM conciliaciones WHERE manifiesto_id = NEW.id;
    -- b) las líneas de solicitud vuelven a pendientes y se libera su programación
    UPDATE ruta_items ri SET liberado = true
      FROM manifiesto_items mi WHERE mi.manifiesto_id = NEW.id AND ri.solicitud_item_id = mi.solicitud_item_id AND NOT ri.liberado;
    UPDATE solicitud_items si SET estado = 'PENDIENTE', cantidad_real = NULL
      FROM manifiesto_items mi WHERE mi.manifiesto_id = NEW.id AND si.id = mi.solicitud_item_id AND si.estado IN ('REALIZADO', 'PROGRAMADO');
    -- c) se retiran las solicitudes recurrentes que nacieron de él y nadie ha tocado
    DELETE FROM solicitudes WHERE manifiesto_origen_id = NEW.id AND clase = 'PRE' AND aprobacion = 'PENDIENTE' AND estado = 'PENDIENTE';
  END IF;
  RETURN NULL;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_manifiesto_efectos AFTER UPDATE OF estado ON manifiestos
  FOR EACH ROW EXECUTE FUNCTION fn_manifiesto_efectos();

-- Líneas: solo en manifiestos pendientes; declaración válida; la línea de solicitud debe coincidir y no estar en otro manifiesto
CREATE OR REPLACE FUNCTION fn_manifiesto_item_valido() RETURNS trigger AS $$
DECLARE m RECORD; si RECORD;
BEGIN
  SELECT * INTO m FROM manifiestos WHERE id = COALESCE(NEW.manifiesto_id, OLD.manifiesto_id);
  -- (si el manifiesto ya no existe, es un borrado en cascada: m.estado es NULL y no se bloquea)
  IF m.estado <> 'PENDIENTE' THEN
    RAISE EXCEPTION 'El manifiesto % ya está grabado o anulado: no se pueden cambiar sus líneas', m.numero;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  IF NEW.solicitud_item_id IS NOT NULL THEN
    SELECT i.*, s.cliente_id, s.numero AS sol_numero INTO si
      FROM solicitud_items i JOIN solicitudes s ON s.id = i.solicitud_id WHERE i.id = NEW.solicitud_item_id;
    IF si.cliente_id <> m.cliente_id OR si.declaracion_id <> NEW.declaracion_id OR si.sucursal_id <> NEW.sucursal_id THEN
      RAISE EXCEPTION 'La línea no coincide con la solicitud % (cliente, residuo o sede)', si.sol_numero;
    END IF;
    IF si.estado NOT IN ('PENDIENTE', 'PROGRAMADO') THEN
      RAISE EXCEPTION 'La línea de la solicitud % ya fue realizada o descartada', si.sol_numero;
    END IF;
    IF EXISTS (SELECT 1 FROM manifiesto_items x JOIN manifiestos y ON y.id = x.manifiesto_id
                WHERE x.solicitud_item_id = NEW.solicitud_item_id AND x.id <> NEW.id AND y.estado <> 'ANULADO') THEN
      RAISE EXCEPTION 'La línea de la solicitud % ya está en otro manifiesto', si.sol_numero;
    END IF;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_manifiesto_item_valido BEFORE INSERT OR UPDATE OR DELETE ON manifiesto_items
  FOR EACH ROW EXECUTE FUNCTION fn_manifiesto_item_valido();
CREATE TRIGGER trg_manifiesto_item_declaracion BEFORE INSERT OR UPDATE OF declaracion_id, sucursal_id ON manifiesto_items
  FOR EACH ROW EXECUTE FUNCTION fn_item_declaracion_autorizada();

-- Evidencias: máximo 2 fotos y 1 PDF; fotos solo con el manifiesto pendiente (el PDF escaneado puede llegar después)
CREATE OR REPLACE FUNCTION fn_evidencia_valida() RETURNS trigger AS $$
DECLARE est "EstadoManifiesto";
BEGIN
  SELECT estado INTO est FROM manifiestos WHERE id = NEW.manifiesto_id;
  IF est = 'ANULADO' OR (est = 'REALIZADO' AND NEW.tipo = 'FOTO') THEN
    RAISE EXCEPTION 'El manifiesto ya está grabado o anulado: no admite más fotos';
  END IF;
  IF (SELECT count(*) FROM manifiesto_evidencias WHERE manifiesto_id = NEW.manifiesto_id AND tipo = NEW.tipo)
       >= (CASE NEW.tipo WHEN 'FOTO' THEN 2 ELSE 1 END) THEN
    RAISE EXCEPTION 'El manifiesto ya tiene el máximo de evidencias de ese tipo (2 fotos y 1 PDF)';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_evidencia_valida BEFORE INSERT ON manifiesto_evidencias
  FOR EACH ROW EXECUTE FUNCTION fn_evidencia_valida();

-- ---------------------------------------------------------------------
-- 6) Conciliación
-- ---------------------------------------------------------------------
ALTER TABLE conciliacion_items
  ADD CONSTRAINT chk_conc_cantidad CHECK (cantidad_destino IS NULL OR cantidad_destino >= 0),
  ADD CONSTRAINT chk_conc_precio CHECK (precio_unitario IS NULL OR precio_unitario >= 0),
  ADD CONSTRAINT chk_conc_factura_fechas CHECK (factura_emision IS NULL OR factura_vencimiento IS NULL OR factura_vencimiento >= factura_emision);

CREATE OR REPLACE FUNCTION fn_conciliacion_transicion() RETURNS trigger AS $$
DECLARE mf RECORD; incompletas INT;
BEGIN
  IF NEW.estado = OLD.estado THEN RETURN NEW; END IF;
  SELECT numero, estado INTO mf FROM manifiestos WHERE id = NEW.manifiesto_id;
  IF NEW.estado = 'APROBADA' THEN
    IF mf.estado <> 'REALIZADO' THEN RAISE EXCEPTION 'El manifiesto % no está grabado', mf.numero; END IF;
    SELECT count(*) INTO incompletas FROM conciliacion_items
     WHERE conciliacion_id = NEW.id AND (cantidad_destino IS NULL OR precio_unitario IS NULL);
    IF incompletas > 0 THEN
      RAISE EXCEPTION 'Conciliación del manifiesto %: % línea(s) sin cantidad conciliada o sin precio', mf.numero, incompletas;
    END IF;
    NEW.aprobada_en := now();
  ELSE -- volver a borrador
    IF EXISTS (SELECT 1 FROM conciliacion_items ci JOIN actas a ON a.id = ci.acta_id
                WHERE ci.conciliacion_id = NEW.id AND a.estado = 'EMITIDA') THEN
      RAISE EXCEPTION 'Conciliación del manifiesto %: ya está certificada en un acta emitida', mf.numero;
    END IF;
    NEW.aprobada_en := NULL; NEW.aprobada_por := NULL;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_conciliacion_transicion BEFORE UPDATE OF estado ON conciliaciones
  FOR EACH ROW EXECUTE FUNCTION fn_conciliacion_transicion();

-- Después de aprobar solo cambian la factura, el pago y el acta. Asignar a un acta exige conciliación aprobada.
CREATE OR REPLACE FUNCTION fn_conciliacion_item_valido() RETURNS trigger AS $$
DECLARE c RECORD; a RECORD; cliente UUID;
BEGIN
  SELECT * INTO c FROM conciliaciones WHERE id = COALESCE(NEW.conciliacion_id, OLD.conciliacion_id);
  IF TG_OP = 'DELETE' THEN
    IF c.estado = 'APROBADA' THEN RAISE EXCEPTION 'La conciliación está aprobada: no se pueden quitar líneas'; END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF c.estado = 'APROBADA' THEN RAISE EXCEPTION 'La conciliación está aprobada: no se pueden agregar líneas'; END IF;
  ELSIF c.estado = 'APROBADA' AND (
        NEW.cantidad_origen, NEW.cantidad_destino, NEW.metrica_id, NEW.precio_unitario, NEW.tipo_negociacion,
        NEW.forma_pago, NEW.disposicion_id, NEW.orden_compra, NEW.justificacion, NEW.manifiesto_item_id)
      IS DISTINCT FROM (
        OLD.cantidad_origen, OLD.cantidad_destino, OLD.metrica_id, OLD.precio_unitario, OLD.tipo_negociacion,
        OLD.forma_pago, OLD.disposicion_id, OLD.orden_compra, OLD.justificacion, OLD.manifiesto_item_id) THEN
    RAISE EXCEPTION 'La conciliación está aprobada: solo se pueden cambiar los datos de factura y pago';
  END IF;
  -- Acta
  IF TG_OP = 'UPDATE' AND OLD.acta_id IS NOT NULL AND NEW.acta_id IS DISTINCT FROM OLD.acta_id
     AND EXISTS (SELECT 1 FROM actas WHERE id = OLD.acta_id AND estado = 'EMITIDA') THEN
    RAISE EXCEPTION 'La línea ya está certificada en un acta emitida';
  END IF;
  IF NEW.acta_id IS NOT NULL AND NEW.acta_id IS DISTINCT FROM (CASE WHEN TG_OP = 'UPDATE' THEN OLD.acta_id END) THEN
    SELECT * INTO a FROM actas WHERE id = NEW.acta_id;
    SELECT m.cliente_id INTO cliente FROM manifiestos m WHERE m.id = c.manifiesto_id;
    IF c.estado <> 'APROBADA' THEN RAISE EXCEPTION 'Solo se certifican líneas de conciliaciones aprobadas'; END IF;
    IF a.estado <> 'BORRADOR' THEN RAISE EXCEPTION 'El acta % ya fue emitida o anulada', a.numero; END IF;
    IF a.cliente_id <> cliente THEN RAISE EXCEPTION 'La línea es de otro cliente que el acta %', a.numero; END IF;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_conciliacion_item_valido BEFORE INSERT OR UPDATE OR DELETE ON conciliacion_items
  FOR EACH ROW EXECUTE FUNCTION fn_conciliacion_item_valido();

-- ---------------------------------------------------------------------
-- 7) Actas
-- ---------------------------------------------------------------------
ALTER TABLE actas
  ADD CONSTRAINT chk_acta_periodo CHECK (periodo_hasta >= periodo_desde),
  ADD CONSTRAINT chk_acta_anulada CHECK (estado <> 'ANULADA' OR COALESCE(LENGTH(TRIM(motivo_anulacion)), 0) > 0),
  ADD CONSTRAINT chk_acta_cargada CHECK (origen <> 'CARGADA' OR estado = 'BORRADOR' OR archivo_url IS NOT NULL);

CREATE OR REPLACE FUNCTION fn_acta_transicion() RETURNS trigger AS $$
BEGIN
  IF OLD.estado = 'ANULADA' THEN RAISE EXCEPTION 'El acta % está anulada: no se puede modificar', OLD.numero; END IF;
  IF NEW.estado = OLD.estado THEN
    IF OLD.estado = 'EMITIDA' AND (NEW.contenido, NEW.cliente_id, NEW.destino_id, NEW.periodo_desde, NEW.periodo_hasta, NEW.tipo, NEW.numero, NEW.archivo_url)
                         IS DISTINCT FROM (OLD.contenido, OLD.cliente_id, OLD.destino_id, OLD.periodo_desde, OLD.periodo_hasta, OLD.tipo, OLD.numero, OLD.archivo_url) THEN
      RAISE EXCEPTION 'El acta % ya fue emitida: no se puede modificar (anúlela y emita otra)', OLD.numero;
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.estado = 'EMITIDA' AND OLD.estado = 'BORRADOR' THEN
    IF NEW.origen = 'GENERADA' THEN
      IF NOT EXISTS (SELECT 1 FROM conciliacion_items WHERE acta_id = NEW.id) THEN
        RAISE EXCEPTION 'El acta % no tiene líneas conciliadas', NEW.numero;
      END IF;
      IF NEW.contenido IS NULL THEN RAISE EXCEPTION 'El acta % no tiene el contenido certificado', NEW.numero; END IF;
    END IF;
    NEW.emitida_en := COALESCE(NEW.emitida_en, now());
    RETURN NEW;
  END IF;
  IF NEW.estado = 'ANULADA' AND OLD.estado IN ('BORRADOR', 'EMITIDA') THEN
    NEW.anulada_en := COALESCE(NEW.anulada_en, now());
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Transición de estado del acta no permitida (% → %)', OLD.estado, NEW.estado;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_acta_transicion BEFORE UPDATE ON actas
  FOR EACH ROW EXECUTE FUNCTION fn_acta_transicion();

-- Al anular, las líneas quedan libres para otra acta (lo certificado queda en «contenido» del acta anulada)
CREATE OR REPLACE FUNCTION fn_acta_anular() RETURNS trigger AS $$
BEGIN
  IF NEW.estado = 'ANULADA' AND OLD.estado <> 'ANULADA' THEN
    UPDATE conciliacion_items SET acta_id = NULL WHERE acta_id = NEW.id;
  END IF;
  RETURN NULL;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_acta_anular AFTER UPDATE OF estado ON actas
  FOR EACH ROW EXECUTE FUNCTION fn_acta_anular();
