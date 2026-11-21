/**
 * Roles y permisos (20-11-2026, pedido de la gerencia: «una sección de roles donde se describan todas las funciones de la
 * app y podamos decidir cuáles otorgar, con las predeterminadas ya marcadas, y crear roles nuevos, como en Grinclic»).
 *
 * Como en Grinclic, cada rol tiene UN acceso al sistema y solo ve las funciones de ese acceso:
 *   - OFICINA: el personal de Terra Viva en la oficina (tipo interno).
 *   - CAMPO: conductores, auxiliares y planta, desde el celular (tipo interno).
 *   - CLIENTE: el portal de clientes (tipo externo). El portal es otra cosa: sus funciones no son las de la empresa.
 * Cada casilla corresponde a algo que la app de verdad exige (el servidor y la base): ninguna es decorativa.
 */
export type AccesoRol = 'OFICINA' | 'CAMPO' | 'CLIENTE';

export const ACCESOS_ROL: Record<AccesoRol, { nombre: string; tipo: 'Interno' | 'Externo'; descripcion: string }> = {
  OFICINA: { nombre: 'Empresa (oficina)', tipo: 'Interno', descripcion: 'Personal de Terra Viva que trabaja en la aplicación de oficina.' },
  CAMPO: { nombre: 'Campo (conductores, auxiliares y planta)', tipo: 'Interno', descripcion: 'Quien opera rutas y manifiestos desde el celular.' },
  CLIENTE: { nombre: 'Portal de clientes', tipo: 'Externo', descripcion: 'Las personas de cada cliente que entran a su portal: solo ven lo de su empresa.' },
};

export interface FuncionCatalogo { codigo: string; nombre: string; descripcion: string; accesos: AccesoRol[] }
export interface ModuloPermisos { clave: string; nombre: string; permisos: FuncionCatalogo[] }

const O: AccesoRol[] = ['OFICINA'];
const OC: AccesoRol[] = ['OFICINA', 'CAMPO'];
const C: AccesoRol[] = ['CLIENTE'];

/** Todas las funciones que se pueden otorgar, por módulo. El orden es el de la pantalla. */
export const MODULOS_PERMISOS: ModuloPermisos[] = [
  { clave: 'administracion', nombre: 'Administración', permisos: [
    { codigo: '*', nombre: 'Acceso total', descripcion: 'Todo lo de la aplicación de oficina, también lo que se agregue después. Es el del administrador: dele este permiso solo a quien lo necesite.', accesos: O },
    { codigo: 'configuracion.editar', nombre: 'Configuración, usuarios y roles', descripcion: 'Datos de la empresa, catálogos, ajustes de seguridad, usuarios y roles (crear roles y decidir sus permisos).', accesos: O },
  ] },
  { clave: 'comercial', nombre: 'Comercial', permisos: [
    { codigo: 'comercial.gestionar', nombre: 'Gestión comercial', descripcion: 'Prospectos, oportunidades, tareas y cotizaciones. Ganar una oportunidad crea el cliente y sus declaraciones con tarifa.', accesos: O },
  ] },
  { clave: 'clientes', nombre: 'Clientes y sedes', permisos: [
    { codigo: 'clientes.editar', nombre: 'Crear y editar clientes', descripcion: 'Crear y corregir clientes y sus sedes, inactivarlos, expedir la certificación comercial y dar acceso al portal de clientes.', accesos: O },
  ] },
  { clave: 'declaraciones', nombre: 'Declaraciones y tarifas', permisos: [
    { codigo: 'declaraciones.crear', nombre: 'Declarar residuos y servicios', descripcion: 'Crear y corregir las declaraciones de los clientes (quedan en revisión) y asignarlas en forma masiva.', accesos: O },
    { codigo: 'declaraciones.autorizar', nombre: 'Autorizar declaraciones', descripcion: 'Autorizar o rechazar, activar o inactivar declaraciones. Un cambio crítico lo autoriza otra persona (cuatro ojos).', accesos: O },
    { codigo: 'tarifas.asignar', nombre: 'Asignar tarifas', descripcion: 'Fijar y cambiar los precios de las declaraciones, también en forma masiva. Un precio que ya pudo facturarse no se cambia.', accesos: O },
  ] },
  { clave: 'solicitudes', nombre: 'Solicitudes', permisos: [
    { codigo: 'solicitudes.crear', nombre: 'Crear y gestionar solicitudes', descripcion: 'Registrar pedidos de recolección o de entrega en planta, cambiar su estado y cancelarlos.', accesos: O },
    { codigo: 'solicitudes.aprobar', nombre: 'Aprobar solicitudes', descripcion: 'Confirmar o no aprobar los pedidos, también los que llegan del portal de clientes.', accesos: O },
  ] },
  { clave: 'rutas', nombre: 'Rutas y campo', permisos: [
    { codigo: 'rutas.programar', nombre: 'Programar rutas', descripcion: 'Armar y cambiar rutas con vehículo, conductor y auxiliar, descartar líneas y ver el rastreo GPS.', accesos: O },
    { codigo: 'rutas.operar', nombre: 'Operar rutas en campo', descripcion: 'Desde el celular: inspección preoperacional, paradas, estados del recorrido y ubicación.', accesos: OC },
  ] },
  { clave: 'manifiestos', nombre: 'Manifiestos', permisos: [
    { codigo: 'manifiestos.operar', nombre: 'Diligenciar manifiestos', descripcion: 'Diligenciar, firmar y grabar manifiestos de cargue (en la sede) y de descargue (en planta).', accesos: OC },
    { codigo: 'manifiestos.anular', nombre: 'Anular manifiestos', descripcion: 'Anular un manifiesto con su causal y su motivo (queda en el historial).', accesos: O },
  ] },
  { clave: 'conciliaciones', nombre: 'Conciliaciones y facturación', permisos: [
    { codigo: 'conciliaciones.gestionar', nombre: 'Conciliar', descripcion: 'Conciliar cantidades, precios y destinos de cada servicio y registrar facturas y pagos.', accesos: O },
    { codigo: 'conciliaciones.aprobar', nombre: 'Aprobar conciliaciones', descripcion: 'Aprobar y reabrir conciliaciones (lo aprobado es lo que se certifica y se factura).', accesos: O },
    { codigo: 'finanzas.ver', nombre: 'Ver facturación', descripcion: 'Facturas y pagos de Siigo, la regla de certificado de cada cliente y las alertas de manifiestos sin facturar.', accesos: O },
    { codigo: 'finanzas.gestionar', nombre: 'Gestionar facturación', descripcion: 'Sincronizar con Siigo, enlazar facturas, registrar pagos, marcar manifiestos sin cobro y liberar certificados.', accesos: O },
  ] },
  { clave: 'actas', nombre: 'Actas y certificados', permisos: [
    { codigo: 'actas.emitir', nombre: 'Emitir certificados', descripcion: 'Emitir, cargar y anular actas y certificados de disposición.', accesos: O },
  ] },
  { clave: 'cumplimiento', nombre: 'Cumplimiento ambiental', permisos: [
    { codigo: 'permisos.gestionar', nombre: 'Permisos y licencias', descripcion: 'Permisos ambientales, licencias propias y de los gestores aliados, y sus obligaciones.', accesos: O },
  ] },
  { clave: 'informes', nombre: 'Informes y exportación', permisos: [
    { codigo: 'informes.ver', nombre: 'Ver informes', descripcion: 'Informes de operación, indicadores y cifras del tablero.', accesos: O },
    { codigo: 'exportar.masivo', nombre: 'Exportar en bloque', descripcion: 'Exportar a Excel y descargar documentos en bloque (ZIP). Queda en la auditoría.', accesos: O },
  ] },
  { clave: 'importacion', nombre: 'Cargues masivos', permisos: [
    { codigo: 'importacion.cargar', nombre: 'Cargar desde Excel', descripcion: 'Importar clientes, sedes, declaraciones, tarifas, vehículos, usuarios y solicitudes desde Excel o CSV.', accesos: O },
    { codigo: 'importacion.revertir', nombre: 'Deshacer cargues de otros', descripcion: 'Deshacer cargues de otras personas o con declaraciones autorizadas (las anula: no las borra).', accesos: O },
  ] },
  // ---- Portal de clientes (acceso CLIENTE): solo lo de su empresa y, si está limitado, lo de sus sedes ----
  { clave: 'p-sedes', nombre: 'Sedes', permisos: [
    { codigo: 'portal.sedes.ver', nombre: 'Ver sus sedes', descripcion: 'Dirección, ubicación, contactos y horarios de las sedes de su empresa.', accesos: C },
    { codigo: 'portal.sedes.gestionar', nombre: 'Crear y corregir sedes', descripcion: 'Crear sedes, corregir dirección, ubicación GPS, contactos y horarios, e inactivarlas. La sede principal y la zona de ruta las maneja Terra Viva.', accesos: C },
  ] },
  { clave: 'p-declaraciones', nombre: 'Declaraciones', permisos: [
    { codigo: 'portal.declaraciones.ver', nombre: 'Ver sus declaraciones', descripcion: 'Residuos y servicios declarados, su estado, tratamiento y documentos (ficha de seguridad, caracterización).', accesos: C },
    { codigo: 'portal.declaraciones.gestionar', nombre: 'Declarar residuos y servicios', descripcion: 'Declarar con el formulario o con Excel, corregir, retirar e inactivar, con la ficha de seguridad. Quedan en revisión de Terra Viva.', accesos: C },
  ] },
  { clave: 'p-solicitudes', nombre: 'Solicitudes', permisos: [
    { codigo: 'portal.solicitudes.ver', nombre: 'Ver sus solicitudes', descripcion: 'Los pedidos de su empresa y en qué van.', accesos: C },
    { codigo: 'portal.solicitudes.pedir', nombre: 'Pedir recolecciones', descripcion: 'Pedir recolecciones en sus sedes, corregirlas mientras Terra Viva no las confirme, repetirlas y cancelarlas.', accesos: C },
    { codigo: 'portal.entregas.pedir', nombre: 'Pedir entregas en planta', descripcion: 'Llevar el residuo a la planta en su propio vehículo, con conductor, ARL y EPS.', accesos: C },
  ] },
  { clave: 'p-documentos', nombre: 'Manifiestos y certificados', permisos: [
    { codigo: 'portal.manifiestos.ver', nombre: 'Ver y descargar manifiestos', descripcion: 'Cada recolección o entrega, con lo cargado y lo pesado en planta, y su PDF.', accesos: C },
    { codigo: 'portal.certificados.ver', nombre: 'Ver y descargar certificados', descripcion: 'Certificados de disposición (según la regla de pago de su empresa) y la certificación comercial.', accesos: C },
  ] },
  { clave: 'p-informes', nombre: 'Informes', permisos: [
    { codigo: 'portal.informes.ver', nombre: 'Ver informes', descripcion: 'Resumen del año por residuo y mes, e informe general por servicio, en Excel.', accesos: C },
    { codigo: 'portal.precios.ver', nombre: 'Ver tarifas y valores', descripcion: 'Tarifas de sus declaraciones, valor estimado de sus pedidos, y precios y valores conciliados.', accesos: C },
  ] },
  { clave: 'p-usuarios', nombre: 'Usuarios de su empresa', permisos: [
    { codigo: 'portal.usuarios.gestionar', nombre: 'Gestionar usuarios', descripcion: 'Invitar a las personas de su empresa, darles un rol y sus sedes, inactivarlas y restablecer su verificación en dos pasos.', accesos: C },
  ] },
];

/** Los módulos (con sus permisos) que ve un rol con ese acceso. */
export const modulosDeAcceso = (acceso: AccesoRol): ModuloPermisos[] =>
  MODULOS_PERMISOS.map((m) => ({ ...m, permisos: m.permisos.filter((p) => p.accesos.includes(acceso)) })).filter((m) => m.permisos.length > 0);
/** Códigos que admite un rol con ese acceso. */
export const codigosDeAcceso = (acceso: AccesoRol): string[] => modulosDeAcceso(acceso).flatMap((m) => m.permisos.map((p) => p.codigo));

export type ClaveRol = 'ADMINISTRADOR' | 'LOGISTICA' | 'HSEQ' | 'COMERCIAL' | 'FACTURACION' | 'CONDUCTOR' | 'AUXILIAR' | 'CLIENTE_ADMIN' | 'CLIENTE_CONSULTA';
export interface RolPredeterminado { clave: ClaveRol; nombre: string; acceso: AccesoRol; descripcion: string; permisos: string[] }

const PORTAL_VER = ['portal.sedes.ver', 'portal.declaraciones.ver', 'portal.solicitudes.ver', 'portal.manifiestos.ver', 'portal.certificados.ver', 'portal.informes.ver', 'portal.precios.ver'];

/** Roles con los que arranca la empresa: vienen con sus funciones marcadas y se pueden ajustar o restaurar. */
export const ROLES_PREDETERMINADOS: RolPredeterminado[] = [
  { clave: 'ADMINISTRADOR', nombre: 'Administrador', acceso: 'OFICINA', descripcion: 'Gerencia y administración del sistema: acceso total. No se le quitan permisos (así nadie queda por fuera de la configuración).', permisos: ['*'] },
  { clave: 'LOGISTICA', nombre: 'Logística', acceso: 'OFICINA', descripcion: 'Programa rutas, atiende solicitudes, maneja manifiestos y concilia cantidades.',
    permisos: ['solicitudes.crear', 'solicitudes.aprobar', 'rutas.programar', 'rutas.operar', 'importacion.cargar', 'clientes.editar', 'manifiestos.operar', 'manifiestos.anular', 'conciliaciones.gestionar', 'informes.ver', 'exportar.masivo'] },
  { clave: 'HSEQ', nombre: 'HSEQ', acceso: 'OFICINA', descripcion: 'Revisa y autoriza declaraciones, lleva permisos y licencias ambientales y emite los certificados.',
    permisos: ['declaraciones.crear', 'declaraciones.autorizar', 'importacion.revertir', 'permisos.gestionar', 'rutas.operar', 'manifiestos.anular', 'actas.emitir', 'informes.ver', 'exportar.masivo'] },
  { clave: 'COMERCIAL', nombre: 'Comercial', acceso: 'OFICINA', descripcion: 'Clientes, declaraciones, tarifas, solicitudes y gestión comercial (reemplaza a Bigin).',
    permisos: ['declaraciones.crear', 'clientes.editar', 'tarifas.asignar', 'importacion.cargar', 'solicitudes.crear', 'solicitudes.aprobar', 'informes.ver', 'exportar.masivo', 'finanzas.ver', 'comercial.gestionar'] },
  { clave: 'FACTURACION', nombre: 'Facturación', acceso: 'OFICINA', descripcion: 'Tarifas, conciliaciones, facturas y pagos con Siigo.',
    permisos: ['tarifas.asignar', 'conciliaciones.gestionar', 'conciliaciones.aprobar', 'informes.ver', 'exportar.masivo', 'finanzas.ver', 'finanzas.gestionar'] },
  { clave: 'CONDUCTOR', nombre: 'Conductor', acceso: 'CAMPO', descripcion: 'Opera sus rutas en el celular: inspección preoperacional, paradas y manifiestos.', permisos: ['rutas.operar', 'manifiestos.operar'] },
  { clave: 'AUXILIAR', nombre: 'Auxiliar', acceso: 'CAMPO', descripcion: 'Acompaña la ruta: paradas y manifiestos desde el celular.', permisos: ['rutas.operar', 'manifiestos.operar'] },
  { clave: 'CLIENTE_ADMIN', nombre: 'Cliente: administrador', acceso: 'CLIENTE', descripcion: 'Administrador del portal de su empresa: ve todo, declara, pide servicios, gestiona sus sedes y sus usuarios.',
    permisos: codigosDeAcceso('CLIENTE') },
  { clave: 'CLIENTE_CONSULTA', nombre: 'Cliente: consulta', acceso: 'CLIENTE', descripcion: 'Consulta y descarga lo de su empresa (o de sus sedes): no declara ni pide servicios.', permisos: PORTAL_VER },
];
export const rolPredeterminado = (clave: string | null | undefined) => ROLES_PREDETERMINADOS.find((r) => r.clave === clave);
