-- Portal Logístico (gerencia, 21-11-2026): el preoperacional, los vehículos y las fallas viven en Mantenimiento. Residuos no
-- crea tablas de eso: en la ruta queda la constancia de qué la autorizó (el preoperacional apto de Mantenimiento o una
-- excepción de la oficina con su motivo). Regla de Terra Viva: sin preoperacional no hay ruta ni manifiesto.
ALTER TABLE rutas
  ADD COLUMN preop_autorizacion VARCHAR(16),
  ADD COLUMN preop_referencia VARCHAR(60),
  ADD COLUMN preop_detalle VARCHAR(300),
  ADD COLUMN preop_autorizado_por UUID REFERENCES usuarios(id),
  ADD COLUMN preop_autorizado_en TIMESTAMPTZ;
ALTER TABLE rutas ADD CONSTRAINT chk_preop_autorizacion
  CHECK (preop_autorizacion IS NULL OR preop_autorizacion IN ('PREOPERACIONAL', 'EXCEPCION'));
-- La excepción lleva quién la dio y su motivo
ALTER TABLE rutas ADD CONSTRAINT chk_preop_excepcion
  CHECK (preop_autorizacion IS DISTINCT FROM 'EXCEPCION' OR (preop_autorizado_por IS NOT NULL AND length(trim(coalesce(preop_detalle, ''))) >= 10));

-- La ruta no sale (etapas intermedias) sin vehículo, conductor y la constancia del preoperacional de Mantenimiento.
-- Antes se miraba la inspección propia de Residuos (tabla preoperacionales): queda solo como histórico.
CREATE OR REPLACE FUNCTION fn_bloqueo_preoperacional() RETURNS trigger AS $$
DECLARE orden_estado INT; final_estado BOOLEAN;
BEGIN
  SELECT orden, es_final INTO orden_estado, final_estado FROM estados_recorrido WHERE id = NEW.estado_recorrido_id;
  IF orden_estado IS NOT NULL AND orden_estado > 1 AND NOT final_estado THEN
    IF NEW.vehiculo_id IS NULL OR NEW.conductor_id IS NULL THEN
      RAISE EXCEPTION 'La ruta % no puede salir: asigne vehículo y conductor', NEW.codigo;
    END IF;
    IF NEW.preop_autorizacion IS NULL THEN
      RAISE EXCEPTION 'La ruta % no puede salir: el vehículo no tiene preoperacional apto hoy en Mantenimiento', NEW.codigo;
    END IF;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

-- Función nueva: autorizar la salida sin preoperacional (emergencias), para el Jefe de Operaciones
INSERT INTO permisos (id, codigo, nombre) VALUES (gen_random_uuid(), 'rutas.autorizar_sin_preop', 'Autorizar salida sin preoperacional')
ON CONFLICT (codigo) DO UPDATE SET nombre = EXCLUDED.nombre;
INSERT INTO rol_permisos (rol_id, permiso_id)
SELECT r.id, p.id FROM roles r JOIN permisos p ON p.codigo = 'rutas.autorizar_sin_preop' WHERE r.clave = 'JEFE_OPERACIONES'
ON CONFLICT DO NOTHING;

-- El acceso de campo es el Portal Logístico
UPDATE roles SET descripcion = 'Opera sus rutas en el Portal Logístico del celular: paradas y manifiestos; el preoperacional y las fallas, en Mantenimiento.'
 WHERE clave = 'CONDUCTOR';
