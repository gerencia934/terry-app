-- Roles de la cadena del servicio de Terra Viva (gerencia, 20-11-2026):
--   1. Comercial o el Jefe de Operaciones crean el cliente y su acceso al portal.
--   2. El cliente declara y pide la recolección o la entrega en planta.
--   3. El Líder de Operaciones aprueba las recolecciones y arma la ruta; el Jefe de Planta autoriza las entregas en planta.
--   4. El conductor carga en la sede; el Jefe de Planta recibe y genera el manifiesto de entrada.
--   5 y 6. Facturación concilia, factura y libera el acta.
-- Solo agrega y ajusta roles predeterminados; los roles que creó la empresa no pierden nada.

-- 1. Función nueva: autorizar entregas en planta, aparte de aprobar recolecciones
INSERT INTO permisos (id, codigo, nombre) VALUES (gen_random_uuid(), 'solicitudes.autorizar_entrega', 'Autorizar entregas en planta')
ON CONFLICT (codigo) DO UPDATE SET nombre = EXCLUDED.nombre;
UPDATE permisos SET nombre = 'Aprobar recolecciones' WHERE codigo = 'solicitudes.aprobar';

-- Los roles propios de la empresa que aprobaban solicitudes siguen autorizando también las entregas en planta
INSERT INTO rol_permisos (rol_id, permiso_id)
SELECT rp.rol_id, n.id
  FROM rol_permisos rp
  JOIN permisos p ON p.id = rp.permiso_id AND p.codigo = 'solicitudes.aprobar'
  JOIN roles r ON r.id = rp.rol_id AND r.clave IS NULL
  CROSS JOIN permisos n
 WHERE n.codigo = 'solicitudes.autorizar_entrega'
ON CONFLICT DO NOTHING;

-- 2. «Logística» pasa a llamarse Líder de Operaciones: aprueba recolecciones y arma rutas. Crear clientes queda en
--    Comercial y el Jefe de Operaciones («único encargado»), y aprobar recolecciones deja de ser de Comercial.
UPDATE roles SET nombre = 'Líder de Operaciones'
 WHERE clave = 'LOGISTICA' AND nombre = 'Logística'
   AND NOT EXISTS (SELECT 1 FROM roles o WHERE o.empresa_id = roles.empresa_id AND o.nombre = 'Líder de Operaciones');
UPDATE roles SET descripcion = 'Revisa y aprueba las solicitudes de recolección, programa las rutas, maneja los manifiestos y concilia cantidades.' WHERE clave = 'LOGISTICA';
DELETE FROM rol_permisos
 WHERE rol_id IN (SELECT id FROM roles WHERE clave = 'LOGISTICA')
   AND permiso_id IN (SELECT id FROM permisos WHERE codigo = 'clientes.editar');
DELETE FROM rol_permisos
 WHERE rol_id IN (SELECT id FROM roles WHERE clave = 'COMERCIAL')
   AND permiso_id IN (SELECT id FROM permisos WHERE codigo = 'solicitudes.aprobar');

-- 3. Jefe de Operaciones y Jefe de Planta en cada empresa (como los demás predeterminados: se ajustan y se restauran)
INSERT INTO roles (id, empresa_id, nombre, clave, acceso, predeterminado, descripcion)
SELECT gen_random_uuid(), empresa_id, 'Jefe de Operaciones', 'JEFE_OPERACIONES', 'OFICINA', TRUE,
       'Dirige la operación: crea clientes y su acceso al portal, aprueba recolecciones y entregas en planta, programa rutas y concilia.'
  FROM roles WHERE clave = 'ADMINISTRADOR'
ON CONFLICT DO NOTHING;
INSERT INTO roles (id, empresa_id, nombre, clave, acceso, predeterminado, descripcion)
SELECT gen_random_uuid(), empresa_id, 'Jefe de Planta', 'JEFE_PLANTA', 'OFICINA', TRUE,
       'Autoriza las entregas en planta, recibe los residuos y genera el manifiesto de entrada (descargue).'
  FROM roles WHERE clave = 'ADMINISTRADOR'
ON CONFLICT DO NOTHING;

INSERT INTO rol_permisos (rol_id, permiso_id)
SELECT r.id, p.id FROM roles r JOIN permisos p ON p.codigo IN (
  'clientes.editar', 'declaraciones.crear', 'solicitudes.crear', 'solicitudes.aprobar', 'solicitudes.autorizar_entrega', 'rutas.programar',
  'manifiestos.operar', 'manifiestos.anular', 'conciliaciones.gestionar', 'conciliaciones.aprobar', 'importacion.cargar', 'informes.ver', 'exportar.masivo')
 WHERE r.clave = 'JEFE_OPERACIONES'
ON CONFLICT DO NOTHING;
INSERT INTO rol_permisos (rol_id, permiso_id)
SELECT r.id, p.id FROM roles r JOIN permisos p ON p.codigo IN ('solicitudes.autorizar_entrega', 'manifiestos.operar', 'informes.ver')
 WHERE r.clave = 'JEFE_PLANTA'
ON CONFLICT DO NOTHING;
