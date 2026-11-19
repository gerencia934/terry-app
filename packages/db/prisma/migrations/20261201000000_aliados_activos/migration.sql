-- Gestores aliados con los que Terra Viva trabaja hoy (gerencia, 19-11-2026: Veolia, Conyser, Sandesol, Social RAEE,
-- Colbitumen, Geoambiental, Vectors and Waste, Recitrac, Urbaser y EMAS). Un aliado inactivo deja de cubrir disposiciones
-- y de ofrecerse como destino de servicios nuevos; sus actas, manifiestos y licencias se conservan (nada legal se borra).
-- Cuáles quedan activos lo marca la siembra (catálogo GESTORES_ALIADOS) hasta que alguien lo cambie en la aplicación.
ALTER TABLE proveedores ADD COLUMN activo BOOLEAN NOT NULL DEFAULT TRUE;

-- La planta propia (Parque de Saneamiento Ambiental Los Pinos) no se inactiva
ALTER TABLE proveedores ADD CONSTRAINT proveedores_propio_activo CHECK (activo OR NOT es_propio);

-- Un aliado cubre si se trabaja con él y su licencia está registrada y vigente (con fecha o indefinida). La usan
-- fn_disposicion_cubierta y la revisión de exclusiones al autorizar una declaración.
CREATE OR REPLACE FUNCTION fn_aliado_vigente(p_proveedor UUID) RETURNS BOOLEAN AS $$
  SELECT pr.activo AND COALESCE(LENGTH(TRIM(pr.licencia)), 0) > 0 AND (pr.licencia_indefinida OR pr.licencia_vence >= CURRENT_DATE)
  FROM proveedores pr WHERE pr.id = p_proveedor;
$$ LANGUAGE sql STABLE;
