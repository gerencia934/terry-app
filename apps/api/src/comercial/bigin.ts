// Importación desde Bigin (el CRM de Zoho que se reemplaza): los CSV de Empresas, Contactos y Negocios tal como los
// exporta Bigin, en español o en inglés. Las columnas se reconocen por su nombre (sin importar tildes, mayúsculas ni
// signos); el separador (coma, punto y coma o tabulador) se detecta solo. Sin base de datos: se puede probar aparte.
import { decodificar, parsearCsv } from '@terraviva/shared';

export type EtapaImportada = 'NUEVA' | 'CONTACTADA' | 'COTIZADA' | 'NEGOCIACION' | 'GANADA' | 'PERDIDA';
export interface EmpresaBigin {
  fila: number; biginId: string | null; razonSocial: string; nit: string | null; telefono: string | null; sitioWeb: string | null;
  direccion: string | null; ciudad: string | null; notas: string | null; asesor: string | null;
}
export interface ContactoBigin {
  fila: number; biginId: string | null; nombre: string; cargo: string | null; telefono: string | null; correo: string | null;
  empresa: string | null; empresaBiginId: string | null;
}
export interface NegocioBigin {
  fila: number; biginId: string | null; titulo: string; empresa: string | null; empresaBiginId: string | null; contacto: string | null;
  etapa: EtapaImportada; etapaBigin: string; valor: number | null; cierre: string | null; notas: string | null; asesor: string | null;
}
export interface ErrorBigin { archivo: string; fila: number; mensaje: string }

/** Texto comparable: sin tildes, en minúsculas y solo letras, números y espacios. */
export const normalizar = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
/** Nombre de empresa comparable: además sin la forma societaria (S.A.S., LTDA, E.S.P.…). */
export const nombreEmpresa = (s: string) => normalizar(s).replace(/\b(s a s|sas|s a|sa|ltda|limitada|e s p|esp|s en c|y cia|cia|bic)\b/g, ' ').replace(/\s+/g, ' ').trim();

const COLUMNAS = {
  id: ['record id', 'id de registro', 'id del registro', 'id registro', 'registro id'],
  empresa: ['company name', 'account name', 'company', 'nombre de la empresa', 'nombre de empresa', 'empresa', 'nombre de la cuenta', 'cuenta'],
  empresaId: ['company name id', 'account name id', 'company id', 'account id', 'id de la empresa', 'id de empresa', 'id de la cuenta'],
  nit: ['nit', 'tax id', 'identificacion', 'numero de identificacion', 'numero de documento', 'documento'],
  telefono: ['phone', 'telefono', 'mobile', 'movil', 'celular', 'telefono movil'],
  web: ['website', 'sitio web', 'pagina web', 'web'],
  direccion: ['billing street', 'mailing street', 'street', 'calle', 'direccion', 'calle de facturacion'],
  ciudad: ['billing city', 'mailing city', 'city', 'ciudad', 'ciudad de facturacion', 'municipio'],
  notas: ['description', 'descripcion', 'notas', 'notes'],
  asesor: ['deal owner', 'company owner', 'account owner', 'contact owner', 'owner', 'propietario', 'propietario del negocio', 'propietario de la empresa', 'propietario del contacto'],
  nombre: ['first name', 'nombre', 'nombres'],
  apellido: ['last name', 'apellido', 'apellidos'],
  nombreCompleto: ['full name', 'contact name', 'nombre completo', 'nombre del contacto', 'contacto'],
  cargo: ['title', 'cargo', 'titulo', 'puesto'],
  correo: ['email', 'correo', 'correo electronico', 'e mail'],
  titulo: ['deal name', 'pipeline name', 'nombre del negocio', 'nombre de la oportunidad', 'negocio', 'oportunidad'],
  etapa: ['stage', 'etapa', 'sub pipeline stage'],
  valor: ['amount', 'importe', 'monto', 'valor', 'valor del negocio'],
  cierre: ['closing date', 'fecha de cierre', 'cierre', 'close date'],
  contacto: ['contact name', 'nombre del contacto', 'contacto'],
} as const;
type Campo = keyof typeof COLUMNAS;

/** Separador más probable según la primera línea. */
function separador(texto: string) {
  const linea = texto.split(/\r?\n/, 1)[0] ?? '';
  const cuenta = (c: string) => linea.split(c).length - 1;
  return ([',', ';', '\t'] as const).reduce((a, b) => (cuenta(b) > cuenta(a) ? b : a), ',');
}

/** Filas del CSV como objetos con los campos reconocidos (y la lista de columnas que no se usaron). */
function leer(bytes: Uint8Array, campos: Campo[]) {
  const { texto } = decodificar(bytes);
  const filas = parsearCsv(texto.replace(/^﻿/, ''), separador(texto)).filter((f) => f.some((c) => c.trim()));
  if (!filas.length) return { filas: [] as { fila: number; v: Partial<Record<Campo, string>> }[], reconocidas: [] as Campo[] };
  const encabezado = filas[0].map((h) => normalizar(h));
  const indice = new Map<Campo, number>();
  for (const c of campos) {
    // El nombre exacto gana; así «Company Name» no toma «Company Name.id»
    const i = encabezado.findIndex((h) => (COLUMNAS[c] as readonly string[]).includes(h));
    if (i >= 0) indice.set(c, i);
  }
  return {
    reconocidas: [...indice.keys()],
    filas: filas.slice(1).map((f, k) => ({ fila: k + 2, v: Object.fromEntries([...indice].map(([c, i]) => [c, (f[i] ?? '').trim()]).filter(([, x]) => x)) as Partial<Record<Campo, string>> })),
  };
}

const opc = (s: string | undefined, max: number) => (s ? s.slice(0, max) : null);
/** NIT de Colombia sin puntos ni dígito de verificación (6 a 10 dígitos), o nada. */
export function nitDe(s: string | undefined) {
  if (!s) return null;
  const base = s.split('-')[0].replace(/\D/g, '');
  return /^\d{6,10}$/.test(base) ? base : null;
}
/** «COP 1.500.000,00», «1,500,000.00» o «1500000» → número. */
export function valorDe(s: string | undefined) {
  if (!s) return null;
  let x = s.replace(/[^\d.,-]/g, '');
  if (!x) return null;
  const coma = x.lastIndexOf(','), punto = x.lastIndexOf('.');
  if (coma >= 0 && punto >= 0) x = coma > punto ? x.replace(/\./g, '').replace(',', '.') : x.replace(/,/g, '');
  else if (coma >= 0) x = /,\d{1,2}$/.test(x) ? x.replace(/\./g, '').replace(',', '.') : x.replace(/,/g, '');
  else if (punto >= 0 && !/\.\d{1,2}$/.test(x)) x = x.replace(/\./g, '');
  const n = Number(x);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
}
/** «2026-11-30», «30/11/2026» (día primero, como en Colombia) o «Nov 30, 2026» → AAAA-MM-DD. */
export function fechaDe(s: string | undefined) {
  if (!s) return null;
  const t = s.trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(t);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/.exec(t);
  if (m) return Number(m[2]) <= 12 ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}
/** Etapa de Bigin → etapa de TERRY-GO (por palabras: ganado, perdido, negociación, propuesta, calificación…). */
export function etapaDe(s: string | undefined): EtapaImportada {
  const x = normalizar(s ?? '');
  if (/\b(won|ganad[oa]|cerrado ganado|closed won)\b/.test(x)) return 'GANADA';
  if (/\b(lost|perdid[oa]|cerrado perdido|closed lost)\b/.test(x)) return 'PERDIDA';
  if (/negoci|review|revision/.test(x)) return 'NEGOCIACION';
  if (/propuesta|proposal|quote|cotiza|oferta/.test(x)) return 'COTIZADA';
  if (/calific|qualif|contact|needs|analisis|analysis|reunion|visita/.test(x)) return 'CONTACTADA';
  return 'NUEVA';
}

export function leerEmpresas(bytes: Uint8Array) {
  const { filas, reconocidas } = leer(bytes, ['id', 'empresa', 'nit', 'telefono', 'web', 'direccion', 'ciudad', 'notas', 'asesor']);
  const errores: ErrorBigin[] = [];
  if (filas.length && !reconocidas.includes('empresa')) errores.push({ archivo: 'empresas', fila: 1, mensaje: 'No se encontró la columna del nombre de la empresa («Company Name» o «Nombre de la empresa»).' });
  const empresas: EmpresaBigin[] = [];
  for (const { fila, v } of filas) {
    if (!v.empresa) { if (reconocidas.includes('empresa')) errores.push({ archivo: 'empresas', fila, mensaje: 'Sin nombre de empresa.' }); continue; }
    empresas.push({ fila, biginId: opc(v.id, 60), razonSocial: v.empresa.slice(0, 200), nit: nitDe(v.nit), telefono: opc(v.telefono, 30), sitioWeb: opc(v.web, 200),
      direccion: opc(v.direccion, 300), ciudad: opc(v.ciudad, 80), notas: opc(v.notas, 4000), asesor: opc(v.asesor, 150) });
  }
  return { empresas, errores };
}

export function leerContactos(bytes: Uint8Array) {
  const { filas, reconocidas } = leer(bytes, ['id', 'nombre', 'apellido', 'nombreCompleto', 'cargo', 'telefono', 'correo', 'empresa', 'empresaId']);
  const errores: ErrorBigin[] = [];
  const contactos: ContactoBigin[] = [];
  for (const { fila, v } of filas) {
    const nombre = (v.nombre || v.apellido ? [v.nombre, v.apellido].filter(Boolean).join(' ') : v.nombreCompleto ?? '').replace(/\s+/g, ' ').trim();
    if (nombre.length < 2) { errores.push({ archivo: 'contactos', fila, mensaje: 'Sin nombre del contacto.' }); continue; }
    const correo = v.correo && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.correo) ? v.correo.slice(0, 150).toLowerCase() : null;
    contactos.push({ fila, biginId: opc(v.id, 60), nombre: nombre.slice(0, 150), cargo: opc(v.cargo, 100), telefono: opc(v.telefono, 30), correo,
      empresa: opc(v.empresa, 200), empresaBiginId: opc(v.empresaId, 60) });
  }
  if (filas.length && !reconocidas.some((c) => c === 'nombre' || c === 'apellido' || c === 'nombreCompleto')) {
    errores.unshift({ archivo: 'contactos', fila: 1, mensaje: 'No se encontraron las columnas del nombre («First Name» y «Last Name», o «Nombre» y «Apellidos»).' });
  }
  return { contactos, errores };
}

export function leerNegocios(bytes: Uint8Array) {
  const { filas, reconocidas } = leer(bytes, ['id', 'titulo', 'empresa', 'empresaId', 'contacto', 'etapa', 'valor', 'cierre', 'notas', 'asesor']);
  const errores: ErrorBigin[] = [];
  if (filas.length && !reconocidas.includes('titulo')) errores.push({ archivo: 'negocios', fila: 1, mensaje: 'No se encontró la columna del nombre del negocio («Deal Name» o «Nombre del negocio»).' });
  const negocios: NegocioBigin[] = [];
  for (const { fila, v } of filas) {
    if (!v.titulo) { if (reconocidas.includes('titulo')) errores.push({ archivo: 'negocios', fila, mensaje: 'Sin nombre del negocio.' }); continue; }
    negocios.push({ fila, biginId: opc(v.id, 60), titulo: v.titulo.slice(0, 200), empresa: opc(v.empresa, 200), empresaBiginId: opc(v.empresaId, 60),
      contacto: opc(v.contacto, 150), etapa: etapaDe(v.etapa), etapaBigin: v.etapa ?? '', valor: valorDe(v.valor), cierre: fechaDe(v.cierre),
      notas: opc(v.notas, 4000), asesor: opc(v.asesor, 150) });
  }
  return { negocios, errores };
}
