// Piezas compartidas por las pantallas de autogestión del portal de clientes.
import { API_URL, ErrorApi, api } from '../../lib/api';

/** Nombre legible de cada campo que el servidor puede señalar con error. */
const CAMPOS: Record<string, string> = {
  nombre: 'Nombre', codigo: 'Código', codigoInterno: 'Su código', direccion: 'Dirección', municipioDane: 'Municipio', latitud: 'Latitud', longitud: 'Longitud',
  emails: 'Correos', generadorNit: 'NIT del generador', categoriaId: 'Categoría', tipoResiduoId: 'Tipo de residuo', lineaServicioId: 'Línea de servicio',
  descripcionProceso: 'Proceso que lo genera', descripcionServicio: 'Descripción del servicio', composicion: 'Composición', tipoEmbalajeId: 'Tipo de embalaje',
  materialEmbalajeId: 'Material del embalaje', estadoFisico: 'Estado físico', inflamable: 'Inflamable', controladaEstupefacientes: 'Sustancia controlada',
  codigoYId: 'Corriente Y o código A', sucursalIds: 'Sedes', responsabilidadAceptada: 'Declaración de responsabilidad', codigoUn: 'Número UN',
  fechaSolicitada: 'Fecha', items: 'Residuos', destinoId: 'Planta', transporte: 'Vehículo', telefonoContacto: 'Teléfono de contacto', 'transporte.placa': 'Placa',
  'transporte.conductorNombre': 'Conductor', 'transporte.conductorDocumento': 'Cédula del conductor', 'transporte.conductorArlId': 'ARL del conductor',
  'transporte.conductorEpsId': 'EPS del conductor', 'transporte.empresaTransportadora': 'Empresa transportadora', frecuenciaDias: 'Frecuencia', cantidadFrecuencia: 'Cantidad por servicio',
};

/** Mensaje del servidor para el usuario: con los campos que fallaron, si los dice. */
export function errorPortal(e: unknown, def: string) {
  if (!(e instanceof ErrorApi)) return def;
  const d = (e.datos as { detalles?: { campo: string; mensaje: string }[] } | undefined)?.detalles;
  if (!d?.length) return e.message;
  return d.slice(0, 4).map((x) => `${CAMPOS[x.campo] ?? CAMPOS[x.campo.split('.')[0]] ?? x.campo}: ${x.mensaje}`).join(' · ');
}

/** Sube un PDF o una foto y devuelve la referencia firmada que se manda al guardar. */
export async function subirArchivo(f: File) {
  const form = new FormData();
  form.append('archivo', f, f.name);
  return api<{ ref: string; nombre: string; tipo: string; bytes: number }>('/portal/archivos', { form });
}

/**
 * Pide un enlace firmado (POST) y lo abre en otra pestaña. La pestaña se abre antes de esperar, para que el navegador no
 * la bloquee. El enlace puede ser del API (relativo) o del almacenamiento (absoluto).
 */
export async function abrirEnlace(ruta: string) {
  const w = window.open('', '_blank');
  try {
    const r = await api<{ url: string }>(ruta, { metodo: 'POST' });
    const destino = /^https?:\/\//i.test(r.url) ? r.url : `${API_URL}${r.url}`;
    if (w) { w.opener = null; w.location.href = destino; } else window.location.assign(destino);
  } catch (e) { w?.close(); throw e; }
}

export const areaCls = 'min-h-[72px] w-full min-w-0 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg placeholder:text-subtle focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20';
