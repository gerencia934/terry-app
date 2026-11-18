-- =====================================================================
-- Catálogos iniciales del módulo Declaraciones — Terra Viva S.A.S. E.S.P.
-- Idempotente (ON CONFLICT). Datos tomados de la operación real de Terra Viva;
-- los marcados «VERIFICAR» deben confirmarse antes de producción.
-- =====================================================================
\set ON_ERROR_STOP on
SELECT id AS e FROM empresas WHERE nit = '901089780' \gset

-- ---------- Globales (normativos) ----------
INSERT INTO riesgos (id, codigo, nombre) VALUES
  (gen_random_uuid(), 'C', 'Corrosivo'), (gen_random_uuid(), 'R', 'Reactivo'),
  (gen_random_uuid(), 'E', 'Explosivo'), (gen_random_uuid(), 'T', 'Tóxico'),
  (gen_random_uuid(), 'I', 'Inflamable'), (gen_random_uuid(), 'B', 'Biológico-infeccioso'),
  (gen_random_uuid(), 'RAD', 'Radiactivo')
ON CONFLICT (codigo) DO NOTHING;

INSERT INTO sistemas_etiquetado (id, codigo, nombre) VALUES
  (gen_random_uuid(), 'ONU', 'Naciones Unidas (NTC 1692)'),
  (gen_random_uuid(), 'NFPA', 'NFPA 704'),
  (gen_random_uuid(), 'SGA', 'Sistema Globalmente Armonizado'),
  (gen_random_uuid(), 'HMIS', 'HMIS')
ON CONFLICT (codigo) DO NOTHING;

-- Corrientes Y y códigos A: se cargan completas (Y1–Y45 y A1010–A4160) desde
-- packages/db/prisma/datos/codigos_clasificacion.csv. Aquí solo las más usadas en la operación.
INSERT INTO codigos_clasificacion (id, tipo, codigo, descripcion) VALUES
  (gen_random_uuid(), 'Y', 'Y1',  'Desechos clínicos resultantes de la atención médica prestada en hospitales, centros médicos y clínicas'),
  (gen_random_uuid(), 'Y', 'Y8',  'Desechos de aceites minerales no aptos para el uso a que estaban destinados'),
  (gen_random_uuid(), 'Y', 'Y9',  'Mezclas y emulsiones de desechos de aceite y agua o de hidrocarburos y agua'),
  (gen_random_uuid(), 'Y', 'Y12', 'Desechos resultantes de la producción, preparación y utilización de tintas, colorantes, pigmentos, pinturas, lacas o barnices'),
  (gen_random_uuid(), 'Y', 'Y18', 'Residuos resultantes de las operaciones de eliminación de desechos industriales'),
  (gen_random_uuid(), 'A', 'A3020', 'Aceites minerales de desecho no aptos para el uso al que estaban destinados'),
  (gen_random_uuid(), 'A', 'A4060', 'Desechos de mezclas y emulsiones de aceite y agua o de hidrocarburos y agua'),
  (gen_random_uuid(), 'A', 'A1180', 'Montajes eléctricos y electrónicos de desecho o restos de estos')
ON CONFLICT (codigo) DO NOTHING;

-- ---------- Por empresa ----------
INSERT INTO categorias_declarado (id, empresa_id, codigo, nombre) VALUES
  (gen_random_uuid(), :'e', 'RESPEL', 'Residuos peligrosos'),
  (gen_random_uuid(), :'e', 'NOPEL',  'Residuos no peligrosos'),
  (gen_random_uuid(), :'e', 'APROV',  'Aprovechables'),
  (gen_random_uuid(), :'e', 'ESPEC',  'Especiales (RCD, ACU, posconsumo)'),
  (gen_random_uuid(), :'e', 'SERV',   'Servicios')
ON CONFLICT (empresa_id, codigo) DO NOTHING;  -- VERIFICAR con la lista de Terra Viva

INSERT INTO tipos_residuo (id, empresa_id, codigo, nombre) VALUES
  (gen_random_uuid(), :'e', 'HOSP', 'Hospitalario'), (gen_random_uuid(), :'e', 'IND', 'Industrial'),
  (gen_random_uuid(), :'e', 'ESP', 'Especial'),      (gen_random_uuid(), :'e', 'REC', 'Reciclable'),
  (gen_random_uuid(), :'e', 'RAEE', 'RAEE'),         (gen_random_uuid(), :'e', 'ORG', 'Orgánico'),
  (gen_random_uuid(), :'e', 'NA', 'No aplica (servicios)')
ON CONFLICT (empresa_id, codigo) DO NOTHING;

INSERT INTO unidades_negocio (id, empresa_id, codigo, nombre, sigla) VALUES
  (gen_random_uuid(), :'e', '01', 'Tratamiento de residuos', 'TTR'),
  (gen_random_uuid(), :'e', '02', 'Transporte', 'TPT'),
  (gen_random_uuid(), :'e', '03', 'Fumigación', 'FUM'),
  (gen_random_uuid(), :'e', '04', 'Obras civiles', 'CIV'),
  (gen_random_uuid(), :'e', '05', 'Aprovechamiento', 'APR'),
  (gen_random_uuid(), :'e', '11', 'Mantenimiento hidrosanitario', NULL)  -- sin sigla: VERIFICAR
ON CONFLICT (empresa_id, codigo) DO NOTHING;

INSERT INTO lineas_servicio (id, empresa_id, unidad_negocio_id, codigo, nombre, descripcion)
SELECT gen_random_uuid(), :'e', u.id, l.codigo, l.nombre, l.descripcion
  FROM (VALUES
    ('01', '01', 'Operaciones propias de tratamiento y disposición', NULL),
    ('02', '01', 'Tratamiento y disposición externa (tercerizada)', NULL),
    ('03', '01', 'Gestión y disposición de residuos de construcción', NULL),
    ('04', '02', 'Transporte de residuos y materiales peligrosos', NULL),
    ('05', '04', 'Ejecución de obras civiles y ambientales', NULL),
    ('06', '03', 'Saneamiento y fumigación especializada', NULL),
    ('07', '05', 'Venta de aprovechables', NULL),
    ('08', '05', 'Compra y retoma de materiales reciclables', NULL),
    ('09', '01', 'Servicios especiales de gestión y limpieza', NULL),
    ('10', '05', 'Lodos de procesos industriales de preparación de alimentos', NULL),
    ('11', '11', 'Lavado de tanque', 'Mantenimiento, lavado y desinfección de tanque'),
    ('12', '01', 'Mantenimiento de unidades sanitarias portátiles', NULL),
    ('15', '11', 'Hidrolimpieza técnica de cajas', 'Lavado con agua a alta presión (hidrojet). Tarifa plana por caja intervenida'),
    ('19', '11', 'Mantenimiento preventivo con hidrolavadora', 'Lavado a presión con hidrolavadora'),
    ('20', '01', 'Isotanques', 'Isotanque contaminado')
  ) AS l(codigo, unidad, nombre, descripcion)
  JOIN unidades_negocio u ON u.empresa_id = :'e' AND u.codigo = l.unidad
ON CONFLICT (empresa_id, codigo) DO NOTHING;

INSERT INTO metricas (id, empresa_id, codigo, nombre, abreviacion, uso, factor_a_kg) VALUES
  (gen_random_uuid(), :'e', 'kg', 'Kilogramo', 'kg', 'PRECIO', 1),
  (gen_random_uuid(), :'e', 'ton', 'Tonelada', 'ton', 'PRECIO', 1000),
  (gen_random_uuid(), :'e', 'm3', 'Metro cúbico', 'm³', 'PRECIO', NULL),
  (gen_random_uuid(), :'e', 'gal', 'Galón', 'gal', 'PRECIO', NULL),
  (gen_random_uuid(), :'e', 'L', 'Litro', 'L', 'PRECIO', NULL),
  (gen_random_uuid(), :'e', 'und', 'Unidad', 'und', 'PRECIO', NULL),
  (gen_random_uuid(), :'e', 'viaje', 'Viaje', 'viaje', 'PRECIO', NULL),
  (gen_random_uuid(), :'e', 'kg/m3', 'Kilogramo por metro cúbico', 'kg/m³', 'DENSIDAD', NULL),
  (gen_random_uuid(), :'e', 'g/cm3', 'Gramo por centímetro cúbico', 'g/cm³', 'DENSIDAD', NULL),
  (gen_random_uuid(), :'e', 'g/L', 'Gramo por litro', 'g/L', 'DENSIDAD', NULL),
  (gen_random_uuid(), :'e', 'g/mL', 'Gramo por mililitro', 'g/mL', 'DENSIDAD', NULL),
  (gen_random_uuid(), :'e', 'kg/L', 'Kilogramo por litro', 'kg/L', 'DENSIDAD', NULL)
ON CONFLICT (empresa_id, codigo) DO NOTHING;

INSERT INTO tipos_embalaje (id, empresa_id, codigo, nombre, es_otro) VALUES
  (gen_random_uuid(), :'e', 'BIGBAG', 'Big bag', false), (gen_random_uuid(), :'e', 'BOLSA', 'Bolsa', false),
  (gen_random_uuid(), :'e', 'CAJA', 'Caja', false),      (gen_random_uuid(), :'e', 'VACTOR', 'Camión de vacío', false),
  (gen_random_uuid(), :'e', 'CANECA', 'Caneca o tambor', false), (gen_random_uuid(), :'e', 'ESTIBA', 'Carga estibada', false),
  (gen_random_uuid(), :'e', 'FURGON', 'Furgón cerrado', false),  (gen_random_uuid(), :'e', 'GRANEL', 'A granel', false),
  (gen_random_uuid(), :'e', 'GUARDIAN', 'Guardián', false),      (gen_random_uuid(), :'e', 'ISOTANQUE', 'Isotanque', false),
  (gen_random_uuid(), :'e', 'TANQUE', 'Carrotanque', false),     (gen_random_uuid(), :'e', 'OTRO', 'Otro', true)
ON CONFLICT (empresa_id, codigo) DO NOTHING;

INSERT INTO materiales_embalaje (id, empresa_id, codigo, nombre, es_otro) VALUES
  (gen_random_uuid(), :'e', 'MET', 'Metálico', false), (gen_random_uuid(), :'e', 'PLA', 'Plástico', false),
  (gen_random_uuid(), :'e', 'LONA', 'Lona', false),    (gen_random_uuid(), :'e', 'CAR', 'Cartón', false),
  (gen_random_uuid(), :'e', 'MAD', 'Madera', false),   (gen_random_uuid(), :'e', 'PAP', 'Papel', false),
  (gen_random_uuid(), :'e', 'VID', 'Vidrio', false),   (gen_random_uuid(), :'e', 'OTRO', 'Otro', true)
ON CONFLICT (empresa_id, codigo) DO NOTHING;

-- Disposiciones. propia = Terra Viva (PSA Los Pinos); propia = false ⇒ gestor aliado (proveedor_id).
INSERT INTO disposiciones (id, empresa_id, codigo, nombre, requiere_permiso, propia, soporte_legal) VALUES
  (gen_random_uuid(), :'e', 'APR', 'Aprovechamiento', false, true, 'Objeto social — Certificado de existencia y representación legal'),
  (gen_random_uuid(), :'e', 'REC', 'Reciclaje o valorización', false, true, 'Objeto social — Certificado de existencia y representación legal'),
  (gen_random_uuid(), :'e', 'BIO', 'Biorremediación (landfarming)', true, true, 'Res. CAS 0632-2023'),
  (gen_random_uuid(), :'e', 'ASP', 'Tratamiento y vertimiento a suelo de aguas residuales, lodos, cortes y salmueras', true, true, 'Res. CAS 0632-2023'),
  (gen_random_uuid(), :'e', 'RCD', 'Gestión integral de RCD (aprovechamiento y disposición final)', true, true, 'Res. CAS 0235-2024'),
  (gen_random_uuid(), :'e', 'ACU', 'Aprovechamiento de ACU (biodiésel)', true, true, 'VERIFICAR: OF-311-21 o Res. 316 de 2018 CAS'),
  (gen_random_uuid(), :'e', 'TRA', 'Transporte de RESPEL, hidrocarburos y sustancias nocivas', true, true, 'Auto SAA 0244-21 (Plan de contingencia)'),
  (gen_random_uuid(), :'e', 'LAV', 'Lavado y reúso', true, true, 'VERIFICAR'),
  (gen_random_uuid(), :'e', 'INCH', 'Incineración (hospitalarios y similares)', true, false, 'Res. 0144 de 2000 CDMB (gestor aliado)'),
  (gen_random_uuid(), :'e', 'INCO', 'Incineración y celda ordinaria', true, false, 'Res. 0144 de 2000 CDMB (gestor aliado)'),
  (gen_random_uuid(), :'e', 'RS',  'Relleno sanitario', true, false, 'Res. CAS 0001121 de 2014 (gestor aliado)'),
  (gen_random_uuid(), :'e', 'COP', 'Coprocesamiento', true, false, 'Licencia del gestor aliado'),
  (gen_random_uuid(), :'e', 'DES', 'Desensamble y aprovechamiento (RAEE)', true, false, 'Licencia del gestor aliado'),
  (gen_random_uuid(), :'e', 'DF',  'Disposición final (celda de seguridad)', true, false, 'Licencia del gestor aliado'),
  (gen_random_uuid(), :'e', 'POS', 'Posconsumo', true, false, 'Programa posconsumo del fabricante')
ON CONFLICT (empresa_id, codigo) DO NOTHING;

-- Qué disposición ampara cada permiso de la CAS (antes: manejos_cubiertos)
INSERT INTO permiso_disposiciones (permiso_id, disposicion_id)
SELECT p.id, d.id
  FROM (VALUES ('Resolución 0632-2023', 'BIO'), ('Resolución 0632-2023', 'ASP'),
               ('Resolución 0235-2024', 'RCD'), ('Auto SAA No. 0244-21', 'TRA'),
               ('OF-311-21', 'ACU')) AS x(acto, cod)
  JOIN permisos_ambientales p ON p.empresa_id = :'e' AND p.acto = x.acto
  JOIN disposiciones d ON d.empresa_id = :'e' AND d.codigo = x.cod
ON CONFLICT DO NOTHING;
