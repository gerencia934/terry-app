/**
 * Bitácora de tiempos y tareas logísticas (gerencia, 20-11-2026): tiempos muertos y actividades que no son una
 * recolección. Tipos con los que arranca cada empresa; se ajustan desde la bitácora de la oficina (catálogo
 * TIEMPO_LOGISTICO). Mismo estándar que la bitácora de actividades de Mantenimiento.
 */
export const TIPOS_TIEMPO_INICIALES: { codigo: string; nombre: string; color: string }[] = [
  { codigo: 'TRANCON', nombre: 'Trancón severo', color: '#B42318' },
  { codigo: 'PORTERIA', nombre: 'Espera en portería o autorización del cliente', color: '#B54708' },
  { codigo: 'INSUMOS', nombre: 'Compra de insumos', color: '#1F4E5F' },
  { codigo: 'TANQUEO', nombre: 'Tanqueo', color: '#475467' },
  { codigo: 'FALLA', nombre: 'Falla del vehículo', color: '#912018' },
  { codigo: 'DESCARGUE', nombre: 'Espera de descargue en planta', color: '#1F5E3B' },
  { codigo: 'TRAMITES', nombre: 'Trámites y documentos', color: '#6941C6' },
  { codigo: 'OTRO', nombre: 'Otro', color: '#667085' },
];
/** Días durante los que cada quien corrige o borra sus propios registros (como en Mantenimiento). */
export const DIAS_CORRECCION_BITACORA = 7;
