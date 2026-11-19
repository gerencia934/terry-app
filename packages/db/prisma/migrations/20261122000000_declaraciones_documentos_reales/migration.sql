-- =====================================================================
-- Documentos reales de la operación (19-11-2026) — parte de declaraciones
-- Ver docs/referencia/ANALISIS_DOCUMENTOS_REALES.md (§3 permisos, §4 planilla DMR).
--   1) Subcorrientes del IDEAM: Y9.1 → Y9 (campo padre)
--   2) Solicitudes automáticas agrupadas por sede y fecha (una solicitud con varios ítems)
--   3) Permisos tomados del certificado PSAP2026-296 (el acto del ACU es el Oficio SAA 0311-21)
-- =====================================================================

-- 1) Subcorrientes ------------------------------------------------------
ALTER TABLE codigos_clasificacion ADD COLUMN padre_id UUID REFERENCES codigos_clasificacion(id);
CREATE INDEX ix_codigo_padre ON codigos_clasificacion (padre_id);

-- Un solo nivel, mismo tipo que la corriente y el código empieza por el de la corriente y un punto.
CREATE OR REPLACE FUNCTION fn_subcorriente_valida() RETURNS trigger AS $$
DECLARE p codigos_clasificacion;
BEGIN
  IF NEW.padre_id IS NULL THEN
    IF NEW.codigo LIKE '%.%' THEN RAISE EXCEPTION 'La subcorriente % necesita su corriente (padre)', NEW.codigo; END IF;
    RETURN NEW;
  END IF;
  SELECT * INTO p FROM codigos_clasificacion WHERE id = NEW.padre_id;
  IF p.padre_id IS NOT NULL THEN RAISE EXCEPTION 'La corriente % ya es una subcorriente: solo hay un nivel', p.codigo; END IF;
  IF p.tipo <> NEW.tipo THEN RAISE EXCEPTION 'La subcorriente % debe ser del mismo tipo que %', NEW.codigo, p.codigo; END IF;
  IF NEW.codigo NOT LIKE p.codigo || '.%' THEN RAISE EXCEPTION 'La subcorriente % debe empezar por % y un punto', NEW.codigo, p.codigo; END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_subcorriente_valida BEFORE INSERT OR UPDATE OF codigo, tipo, padre_id ON codigos_clasificacion
  FOR EACH ROW EXECUTE FUNCTION fn_subcorriente_valida();

-- 2) Solicitudes automáticas agrupadas ----------------------------------
-- Antes: una solicitud recurrente por cada residuo. Ahora: una por sede y fecha, con un ítem por declaración.
-- El agrupamiento es dentro del manifiesto: así, al anularlo, se retiran exactamente las que nacieron de él.
CREATE OR REPLACE FUNCTION fn_manifiesto_efectos() RETURNS trigger AS $$
DECLARE conc UUID; g RECORD; sol UUID;
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
    -- c) solicitudes recurrentes (clase PRE): una por sede y fecha, solo de declaraciones autorizadas, activas
    --    y asignadas a esa sede
    FOR g IN SELECT mi.sucursal_id, NEW.fecha_servicio + d.frecuencia_dias AS fecha, min(d.frecuencia_dias) AS frecuencia
               FROM manifiesto_items mi JOIN declaraciones d ON d.id = mi.declaracion_id
              WHERE mi.manifiesto_id = NEW.id AND NEW.tipo = 'CARGUE'
                AND d.solicitud_automatica AND d.frecuencia_dias IS NOT NULL AND d.estado = 'AUTORIZADA' AND d.activa
                AND EXISTS (SELECT 1 FROM declaracion_sucursales ds WHERE ds.declaracion_id = d.id AND ds.sucursal_id = mi.sucursal_id AND ds.activa)
              GROUP BY mi.sucursal_id, NEW.fecha_servicio + d.frecuencia_dias
              ORDER BY 2, 1
    LOOP
      INSERT INTO solicitudes (id, empresa_id, clase, operacion, cliente_id, fecha_solicitada, fecha_activacion, manifiesto_origen_id, creado_por)
      VALUES (gen_random_uuid(), NEW.empresa_id, 'PRE', 'CARGA', NEW.cliente_id, g.fecha, g.fecha - LEAST(3, g.frecuencia), NEW.id, NEW.realizado_por)
      RETURNING id INTO sol;
      INSERT INTO solicitud_items (id, solicitud_id, declaracion_id, sucursal_id, cantidad_estimada)
      SELECT DISTINCT ON (d.id) gen_random_uuid(), sol, d.id, mi.sucursal_id, d.cantidad_frecuencia
        FROM manifiesto_items mi JOIN declaraciones d ON d.id = mi.declaracion_id
       WHERE mi.manifiesto_id = NEW.id AND mi.sucursal_id = g.sucursal_id AND NEW.fecha_servicio + d.frecuencia_dias = g.fecha
         AND d.solicitud_automatica AND d.estado = 'AUTORIZADA' AND d.activa
         AND EXISTS (SELECT 1 FROM declaracion_sucursales ds WHERE ds.declaracion_id = d.id AND ds.sucursal_id = mi.sucursal_id AND ds.activa)
       ORDER BY d.id, mi.id;
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

-- 3) Permisos del certificado PSAP2026-296 -------------------------------
-- El ACU lo ampara el Oficio SAA 0311-21 (inscripción como gestor); la Res. 316 de 2018 es la norma bajo la que se
-- inscribió, no un acto propio de Terra Viva. Nada legal se borra (docs/REQUISITOS_PRODUCCION.md §3): el registro se
-- conserva por trazabilidad, deja de amparar disposiciones y sus obligaciones dejan de alertar.
UPDATE permisos_ambientales SET acto = 'Oficio SAA No. 0311-21',
       alcance = 'Inscripción como gestor de aceite de cocina usado (ACU), conforme a la Resolución 316 de 2018'
 WHERE acto = 'OF-311-21';
DELETE FROM permiso_disposiciones WHERE permiso_id IN (SELECT id FROM permisos_ambientales WHERE acto = 'Resolución 316 de 2018' AND autoridad = 'CAS');
UPDATE obligaciones_permiso SET cumplida = true
 WHERE permiso_id IN (SELECT id FROM permisos_ambientales WHERE acto = 'Resolución 316 de 2018' AND autoridad = 'CAS');
UPDATE permisos_ambientales SET estado = 'VENCIDO',
       alcance = 'No es un acto de Terra Viva: es la norma bajo la que se inscribió el Oficio SAA 0311-21. Se conserva por trazabilidad y no ampara disposiciones.'
 WHERE acto = 'Resolución 316 de 2018' AND autoridad = 'CAS';
UPDATE permisos_ambientales SET acto = 'Resolución DGL No. 000632 de 2023', expedicion = COALESCE(expedicion, DATE '2023-08-15'),
       alcance = 'Tratamiento y vertimiento al suelo de aguas residuales industriales (ARI) y lodos; caudal autorizado 3,65 L/s'
 WHERE acto = 'Resolución 0632-2023';
UPDATE permisos_ambientales SET alcance = 'Plan de contingencia para el transporte de hidrocarburos, derivados y residuos peligrosos (Rad. 80.30.17312.2024)'
 WHERE acto = 'Auto SAA No. 0244-21';
-- Los actos nuevos (Oficio SAO 1762-2023 y el plan de contingencia de la CDMB) los crean los datos iniciales.

UPDATE disposiciones SET soporte_legal = 'Res. DGL 000632 de 2023 (CAS)' WHERE soporte_legal = 'Res. CAS 0632-2023';
UPDATE disposiciones SET soporte_legal = 'Oficio SAA 0311-21 (CAS), conforme a la Res. 316 de 2018' WHERE soporte_legal = 'OF-311-21 y Res. CAS 316 de 2018';
UPDATE disposiciones SET soporte_legal = 'Auto SAA 0244-21 (CAS) y Exp. TH 0013-2021 (CDMB)' WHERE soporte_legal = 'Auto SAA 0244-21 (Plan de contingencia)';
