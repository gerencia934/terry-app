import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react';
import { Download, Upload, FileSpreadsheet, CheckCircle2, XCircle, AlertTriangle, PlayCircle, Loader2, History, Info, Undo2 } from 'lucide-react';
import { Badge, Button, Card, EstadoBadge, Field, PageHeader, Select, Sheet, Tabs, useToast } from '../components/ui';
import {
  DELIMITADORES, ErrorPlanilla, PLANTILLAS, construirPlantillaCsv, delimitadorDe, leerPlanilla, nombreDelimitador, plantilla, validarFilas,
  type FilaValidada, type Plantilla,
} from '@terraviva/shared';
import { contextoActual } from '../cargues/contexto';
import { cx, fmtFechaHora } from '../lib/format';
import { MODO_REAL, api, ErrorApi, tienePermiso } from '../lib/api';

// Filas de ejemplo (algunas con errores a propósito) para probar sin preparar un archivo.
const EJEMPLOS: Record<string, Record<string, string>[]> = {
  clientes: [
    { nit: '901089780', dv: '8', razon: 'Cliente Demo Correcto S.A.S.', persona: 'Jurídica', sector: 'Hidrocarburos', negociacion: 'Cobro', pago: 'Crédito 30 días', email: 'facturas@demo.com' },
    { nit: '900556677', dv: '3', razon: 'DV equivocado S.A.S.', negociacion: 'Cobro', pago: 'Contado' },
    { nit: '800123456', razon: 'Sin forma de pago Ltda.', negociacion: 'Cobro', pago: '' },
    { nit: '901445566', razon: 'Correo malo S.A.S.', negociacion: 'Trueque', pago: 'Contado', email: 'facturas@' },
    { nit: '901089780', dv: '8', razon: 'Duplicado del primero', negociacion: 'Cobro', pago: 'Contado' },
  ],
  sucursales: [
    { nit: '900112345', nombre: 'Bodega norte', direccion: 'Km 2 vía Lebrija', municipio: 'Lebrija', depto: 'Santander', contacto: 'Ana Ruiz', lat: '7.11', lng: '-73.22' },
    { nit: '999888777', nombre: 'Sede fantasma', direccion: 'Cl 1', municipio: 'Girón', depto: 'Santander' },
    { nit: '804009876', nombre: 'Sede Ruitoque', direccion: 'Anillo vial', municipio: 'Floridablanca', depto: 'Santander', lat: '27.5', lng: '-73.1' },
  ],
  'decl-residuos': [
    { nit: '900112345', sucursal: 'Planta extractora', codigo: 'RP-018', residuo: 'Lodos aceitosos', estadoFisico: 'Semisólido / lodo', linea: 'Lodos', manejo: 'Biorremediación (landfarming)', peligroso: 'Sí', corrienteY: 'Y18', unidad: 'kg', cantidad: '8000', frecuencia: 'Mensual', precio: '780' },
    { nit: '804009876', sucursal: 'Sede Cabecera', codigo: 'RH-001', residuo: 'Biosanitarios', estadoFisico: 'Sólido', linea: 'Hospitalarios y biomédicos', manejo: 'Incineración (gestor aliado)', peligroso: 'Sí', corrienteY: 'Y1', unidad: 'kg', cantidad: '1800' },
    { nit: '900112345', sucursal: 'Bodega inexistente', codigo: 'RP-009', residuo: 'Trapos contaminados', estadoFisico: 'Sólido', linea: 'RESPEL', manejo: 'Biorremediación (landfarming)', peligroso: 'Sí', corrienteY: 'Y99', unidad: 'kg', cantidad: 'mucho' },
    { nit: '901223456', sucursal: 'EDS Principal', codigo: 'RP-008', residuo: 'Aceite usado', estadoFisico: 'Líquido', linea: 'Aceite usado de motor', manejo: 'Regeneración de aceite (gestor aliado)', peligroso: 'Sí', unidad: 'gal' },
  ],
  'decl-servicios': [
    { nit: '900778123', sucursal: 'Obra Torres del Parque', codigo: 'SV-USP', servicio: 'Alquiler USP', linea: 'Unidades sanitarias portátiles', frecuencia: 'Mensual', progAuto: 'Sí', cantidad: '12', precio: '420000' },
    { nit: '900778123', sucursal: 'Obra Torres del Parque', codigo: 'SV-USPM', servicio: '', linea: 'Unidades sanitarias portátiles' },
  ],
  precios: [
    { numero: '1001', precio: '820', desde: '2027-01-01' }, { numero: '1008', precio: '3400', negociacion: 'Cobro', desde: '2027-01-01' },
    { numero: '9999', precio: '100', desde: '2027-01-01' }, { numero: '1012', precio: '-5', desde: '01/01/2027' },
  ],
  vehiculos: [
    { placa: 'USD855', marca: 'Chevrolet', tipo: 'Furgón', capacidad: '3500', soat: '2027-03-02', rtm: '2027-02-11' },
    { placa: 'TVA321', marca: 'Hino', tipo: 'Volqueta', capacidad: '14', unidadCap: 'm³', soat: '2027-05-01', rtm: '2027-05-01' },
    { placa: 'AB-12', marca: 'JMC', tipo: 'Furgón', capacidad: '2000', soat: '2027-01-01', rtm: '' },
  ],
  usuarios: [
    { documento: '1098111222', nombre: 'Conductor Nuevo', email: 'cnuevo@terravivasas.com', rol: 'Conductor', licencia: 'C2', licenciaVence: '2029-01-01', cursoMp: '2027-08-01' },
    { documento: '1098333444', nombre: 'Conductor sin curso', email: 'sincurso@terravivasas.com', rol: 'Conductor', licencia: 'C2' },
    { documento: '1098555666', nombre: 'Correo repetido', email: 'logistica@terravivasas.com', rol: 'Logística' },
  ],
  solicitudes: [
    { nit: '901223456', sucursal: 'EDS Principal', tipo: 'Recolección en sede', fecha: '2026-12-02', jornada: 'AM', codigo: 'RP-008', cantidad: '120' },
    { nit: '901223456', sucursal: 'EDS Principal', tipo: 'Recolección en sede', fecha: '2026-12-02', jornada: 'AM', codigo: 'RP-009', cantidad: '80' },
    { nit: '900112345', sucursal: 'Planta extractora', tipo: 'Recolección en sede', fecha: '2026-12-05', codigo: 'XX-000', cantidad: '10' },
  ],
};

/** Resultado de revisar el archivo (en el navegador o en el API). */
interface Revision { archivo: string; filas: FilaValidada[]; faltantes: string[]; formato: 'XLSX' | 'CSV'; delimitador: string | null; codificacion: string | null; avisos?: string[] }
interface Cargue {
  id?: string; fecha: string; plantilla: string; archivo: string; ok: number; error: number;
  formato?: string; delimitador?: string | null; estado?: string; tipoCargue?: string | null; declaraciones?: number;
  usuario?: string | null; propio?: boolean; revertidoEn?: string | null; revertidoPor?: string | null; motivoReversion?: string | null;
}
interface CargueApi {
  id: string; plantilla: string; tipoCargue: string | null; archivo: string; formato: string; delimitador: string | null; estado: string;
  filasOk: number; filasError: number; creadoEn: string; usuario: string | null; propio: boolean;
  revertidoEn: string | null; motivoReversion: string | null; revertidoPor: { nombre: string } | null; _count: { declaraciones: number };
}
/** Qué pasa al deshacer un cargue (GET importacion/cargues/:id/reversion). */
interface Impacto {
  cargue: { archivo: string; creadoEn: string };
  declaraciones: number; porEstado: Record<string, number>; puede: boolean; impedimento: string | null;
  enUso: { numero: number; nombre: string; solicitudes: number; manifiestos: number }[];
  lista: { numero: number; nombre: string; codigoInterno: string | null; estado: string }[];
}
const HISTORIAL_INICIAL: Cargue[] = [
  { fecha: '2026-11-12 09:41', plantilla: 'Clientes', archivo: 'clientes_noviembre.xlsx', ok: 14, error: 0 },
  { fecha: '2026-11-12 09:55', plantilla: 'Sedes de clientes', archivo: 'sedes_noviembre.xlsx', ok: 31, error: 2 },
  { fecha: '2026-11-05 16:20', plantilla: 'Tarifas', archivo: 'tarifas_2027.xlsx', ok: 58, error: 0 },
];
/** El separador viaja al API como texto: el tabulador, como «tab». */
const sepApi = (d?: string | null) => (d === '\t' ? 'tab' : d ?? '');
/** «1 pendiente», «2 autorizadas»… */
const ESTADO_EN: Record<string, [string, string]> = { BORRADOR: ['en borrador', 'en borrador'], PENDIENTE: ['pendiente', 'pendientes'], AUTORIZADA: ['autorizada', 'autorizadas'], RECHAZADA: ['rechazada', 'rechazadas'] };
const cuantas = (n: number, [una, varias]: [string, string]) => `${n} ${n === 1 ? una : varias}`;
const areaCls = 'min-h-[84px] w-full min-w-0 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg placeholder:text-subtle focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20';

export default function Cargues() {
  const toast = useToast();
  const [pid, setPid] = useState('clientes');
  const [res, setRes] = useState<Revision | null>(null);
  const [cargando, setCargando] = useState(false);
  const [vista, setVista] = useState<'todas' | 'errores' | 'validas'>('todas');
  const [historial, setHistorial] = useState(MODO_REAL ? [] as Cargue[] : HISTORIAL_INICIAL);
  // Último archivo leído: para leerlo de nuevo con otro separador y para confirmarlo tal cual
  const [ultimo, setUltimo] = useState<{ nombre: string; buf: ArrayBuffer } | null>(null);
  const [separador, setSeparador] = useState('');
  const [deshacer, setDeshacer] = useState<Cargue | null>(null);
  const [impacto, setImpacto] = useState<Impacto | null>(null);
  const [motivo, setMotivo] = useState('');
  const [enviando, setEnviando] = useState(false);
  const cargarHistorial = useCallback(() => {
    if (!MODO_REAL) return;
    api<CargueApi[]>('/importacion/historial').then((h) => setHistorial(h.map((x) => ({
      id: x.id, fecha: fmtFechaHora(x.creadoEn), plantilla: PLANTILLAS.find((q) => q.id === x.plantilla)?.nombre ?? x.plantilla, archivo: x.archivo, ok: x.filasOk, error: x.filasError,
      formato: x.formato, delimitador: x.delimitador, estado: x.estado, tipoCargue: x.tipoCargue, declaraciones: x._count.declaraciones, usuario: x.usuario, propio: x.propio,
      revertidoEn: x.revertidoEn, revertidoPor: x.revertidoPor?.nombre ?? null, motivoReversion: x.motivoReversion,
    })))).catch(() => undefined);
  }, []);
  useEffect(() => { cargarHistorial(); }, [cargarHistorial]);
  const [drag, setDrag] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const p = plantilla(pid);

  const elegir = (id: string) => { setPid(id); setRes(null); setVista('todas'); setUltimo(null); setSeparador(''); };
  const bajar = async () => {
    try {
      const { descargar } = await import('../cargues/descargar');
      if (MODO_REAL) descargar(await (await api<Blob>(`/importacion/plantillas/${p.id}/archivo`, { blob: true })).arrayBuffer(), p.archivo);
      else { const { construirPlantilla } = await import('@terraviva/shared'); descargar(await construirPlantilla(p), p.archivo); }
      toast(`Plantilla ${p.archivo} generada.`);
    }
    catch { toast('No se pudo generar la plantilla en este navegador.', 'warn'); }
  };
  // La plantilla en CSV es la misma que entrega el API (GET …/archivo?formato=csv): se arma aquí sin pedirla
  const bajarCsv = async () => {
    const { descargar } = await import('../cargues/descargar');
    const nombre = p.archivo.replace(/\.xlsx$/i, '.csv');
    descargar(construirPlantillaCsv(p), nombre, 'text/csv;charset=utf-8');
    toast(`Plantilla ${nombre} generada, separada por punto y coma (como la guarda Excel en Colombia).`);
  };
  const procesar = async (nombre: string, buf: ArrayBuffer, sep: string) => {
    setCargando(true); setVista('todas'); setUltimo({ nombre, buf });
    try {
      if (MODO_REAL) {
        // El servidor valida contra los datos reales de la empresa.
        const form = new FormData(); form.append('archivo', new Blob([buf]), nombre);
        if (sep) form.append('delimitador', sep);
        setRes(await api<Revision>(`/importacion/${p.id}/vista-previa`, { form }));
      } else {
        const l = await leerPlanilla(p, nombre, buf, { delimitador: delimitadorDe(sep) });
        setRes({ archivo: nombre, filas: validarFilas(p, l.filas, contextoActual()), faltantes: l.faltantes, formato: l.formato, delimitador: l.delimitador ?? null, codificacion: l.codificacion ?? null });
      }
    } catch (e) { toast(e instanceof ErrorApi || e instanceof ErrorPlanilla ? e.message : 'No se pudo leer el archivo. Use la plantilla en .xlsx, o un CSV con sus mismos encabezados.', 'warn'); }
    setCargando(false);
  };
  const subir = async (f?: File | null) => { if (f) { setSeparador(''); await procesar(f.name, await f.arrayBuffer(), ''); } };
  const cambiarSeparador = (v: string) => { setSeparador(v); if (ultimo) procesar(ultimo.nombre, ultimo.buf, v); };
  const probar = async () => {
    setCargando(true);
    const { construirPlantilla } = await import('@terraviva/shared');
    const ExcelJS = ((await import('exceljs')) as unknown as { default: typeof import('exceljs') }).default;
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(await construirPlantilla(p));
    const ws = wb.getWorksheet('Plantilla')!;
    (EJEMPLOS[p.id] ?? []).forEach((fila, i) => { ws.getRow(3 + i).values = p.columnas.map((c) => fila[c.key] ?? ''); });
    setSeparador('');
    await procesar(`ejemplo_${p.id}.xlsx`, (await wb.xlsx.writeBuffer()) as ArrayBuffer, '');
  };
  const validas = res?.filas.filter((f) => !f.errores.length) ?? [];
  const conError = res?.filas.filter((f) => f.errores.length) ?? [];
  const cargar = async () => {
    if (!res) return;
    if (MODO_REAL && ultimo) {
      try {
        // Se confirma con el mismo separador con que se revisó
        const form = new FormData(); form.append('archivo', new Blob([ultimo.buf]), ultimo.nombre);
        if (res.formato === 'CSV' && res.delimitador) form.append('delimitador', sepApi(res.delimitador));
        const r = await api<{ creadas: number; actualizadas: number; rechazadas: number }>(`/importacion/${p.id}/confirmar`, { form });
        toast(`Guardado: ${r.creadas} nuevos y ${r.actualizadas} actualizados.${r.rechazadas ? ` ${r.rechazadas} filas con errores quedaron por fuera.` : ''}`);
        setRes(null); setUltimo(null); cargarHistorial();
      } catch (e) { toast(e instanceof ErrorApi ? e.message : 'No se pudo guardar.', 'warn'); }
      return;
    }
    setHistorial((h) => [{ fecha: '2026-11-18 ' + new Date().toTimeString().slice(0, 5), plantilla: p.nombre, archivo: res.archivo, ok: validas.length, error: conError.length, formato: res.formato, delimitador: res.delimitador }, ...h]);
    toast(`Se cargaron ${validas.length} registros de «${p.nombre}». ${conError.length ? `${conError.length} filas con errores quedaron por fuera.` : ''}`);
    setRes(null);
  };
  const bajarErrores = async () => { const { exportarErrores } = await import('@terraviva/shared'); const { descargar } = await import('../cargues/descargar'); descargar(await exportarErrores(p, conError), `errores_${p.archivo}`); };
  const visibles = vista === 'errores' ? conError : vista === 'validas' ? validas : res?.filas ?? [];
  const resumen = (f: FilaValidada) => p.columnas.slice(0, 3).map((c) => f.datos[c.key]).filter(Boolean).join(' · ');

  // Deshacer un cargue de declaraciones: el API dice si se puede y qué se anula
  const puedeDeshacer = (h: Cargue) => MODO_REAL && !!h.id && h.estado === 'CONFIRMADO' && h.tipoCargue === 'DECLARACIONES' && (h.declaraciones ?? 0) > 0
    && (tienePermiso('importacion.revertir') || (!!h.propio && tienePermiso('importacion.cargar')));
  const abrirDeshacer = async (h: Cargue) => {
    setDeshacer(h); setImpacto(null); setMotivo('');
    try { setImpacto(await api<Impacto>(`/importacion/cargues/${h.id}/reversion`)); }
    catch (e) { toast(e instanceof ErrorApi ? e.message : 'No se pudo consultar el cargue.', 'warn'); setDeshacer(null); }
  };
  const cerrarDeshacer = useCallback(() => setDeshacer(null), []);
  const confirmarDeshacer = async () => {
    if (!deshacer?.id) return;
    setEnviando(true);
    try {
      const r = await api<{ anuladas: number; archivo: string }>(`/importacion/cargues/${deshacer.id}/revertir`, { metodo: 'POST', cuerpo: { motivo: motivo.trim() } });
      toast(`Cargue «${r.archivo}» deshecho: ${r.anuladas} ${r.anuladas === 1 ? 'declaración anulada' : 'declaraciones anuladas'}. Ya puede cargar el archivo corregido.`);
      setDeshacer(null); cargarHistorial();
    } catch (e) { toast(e instanceof ErrorApi ? e.message : 'No se pudo deshacer el cargue.', 'warn'); }
    setEnviando(false);
  };
  const autorizadas = impacto?.porEstado.AUTORIZADA ?? 0;

  return (
    <>
      <PageHeader eyebrow="Ajustes" title="Importar datos" subtitle="Descargue la plantilla, llénela en Excel y súbala como Excel o CSV. Cada fila se revisa antes de guardar y nada se guarda hasta que usted confirme." />
      <div className="grid gap-5 xl:grid-cols-[300px_1fr]">
        {/* Plantillas */}
        <div className="flex flex-col gap-2">
          {PLANTILLAS.map((x: Plantilla) => (
            <button key={x.id} onClick={() => elegir(x.id)} className={cx('flex items-start gap-3 rounded-xl border p-3 text-left transition-colors', pid === x.id ? 'border-brand bg-brand-soft/60' : 'border-line bg-surface hover:border-brand/50')}>
              <FileSpreadsheet size={20} className={cx('mt-0.5 shrink-0', pid === x.id ? 'text-brand' : 'text-subtle')} />
              <span className="min-w-0"><span className="block text-[14px] font-semibold">{x.nombre}</span><span className="block text-[12px] text-muted">{x.columnas.length} columnas · {x.columnas.filter((c) => c.requerido).length} obligatorias</span></span>
            </button>
          ))}
        </div>

        <div className="flex min-w-0 flex-col gap-5">
          <Card>
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0"><h2 className="text-[17px] font-semibold">{p.nombre}</h2><p className="mt-1 max-w-[70ch] text-muted">{p.descripcion}</p></div>
              <div className="flex shrink-0 flex-wrap gap-2">
                <Button onClick={bajar}><Download size={16} /> Descargar plantilla</Button>
                <Button variant="ghost" onClick={bajarCsv} title="Los mismos encabezados, en CSV separado por punto y coma">En CSV</Button>
                <Button variant="primary" onClick={probar} disabled={cargando}><PlayCircle size={16} /> Probar con archivo de ejemplo</Button>
              </div>
            </div>
            <details className="mt-4 rounded-lg border border-line">
              <summary className="cursor-pointer px-3 py-2 text-[13px] font-medium">Ver las {p.columnas.length} columnas de la plantilla</summary>
              <div className="scroll-x"><table className="w-full min-w-[620px] text-[13px]">
                <thead className="bg-surface-2 text-left text-[12px] uppercase tracking-[0.04em] text-muted"><tr><th className="px-3 py-2">Columna</th><th className="px-3 py-2">Obligatoria</th><th className="px-3 py-2">Formato</th><th className="px-3 py-2">Instrucción</th></tr></thead>
                <tbody>{p.columnas.map((c) => <tr key={c.key} className="border-t border-line"><td className="px-3 py-2 font-medium">{c.header}</td><td className="px-3 py-2">{c.requerido ? <Badge tone="brand">Sí</Badge> : <span className="text-muted">No</span>}</td><td className="px-3 py-2 text-muted">{c.opciones ? `Lista (${c.opciones.length})` : { texto: 'Texto', numero: 'Número', fecha: 'AAAA-MM-DD', lista: 'Lista', email: 'Correo', si_no: 'Sí / No', codigo: c.multiple ? 'Códigos separados por ;' : 'Código del catálogo' }[c.tipo]}</td><td className="px-3 py-2 text-muted">{c.ayuda || '—'}</td></tr>)}</tbody>
              </table></div>
            </details>
            <div onDragOver={(e: DragEvent) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={(e: DragEvent) => { e.preventDefault(); setDrag(false); subir(e.dataTransfer.files[0]); }}
              className={cx('mt-4 flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-8 text-center transition-colors', drag ? 'border-brand bg-brand-soft/50' : 'border-line')}>
              {cargando ? <Loader2 size={28} className="animate-spin text-brand" /> : <Upload size={28} className="text-brand" />}
              <p className="font-medium">{cargando ? 'Leyendo y validando…' : 'Arrastre aquí la plantilla diligenciada'}</p>
              <p className="text-[13px] text-muted">o</p>
              <Button onClick={() => input.current?.click()} disabled={cargando}>Elegir archivo (.xlsx o .csv)</Button>
              <p className="max-w-[60ch] text-[12px] text-muted">En CSV sirven el «CSV UTF-8» y el «CSV (delimitado por comas)» de Excel, con punto y coma, coma, tabulador o barra. El separador se detecta solo.</p>
              <input ref={input} id="cargue-archivo" type="file" accept=".xlsx,.csv,.txt,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" className="sr-only" onChange={(e) => { subir(e.target.files?.[0]); e.target.value = ''; }} />
            </div>
          </Card>

          {res && (
            <Card title={<span className="flex items-center gap-2"><FileSpreadsheet size={17} className="text-brand" />Revisión de «{res.archivo}»</span>} pad={false}>
              <div className="flex flex-col gap-3 p-4">
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <p className="text-[13px] text-muted">{res.formato === 'CSV'
                    ? <>Archivo CSV separado por <span className="font-semibold text-fg">{nombreDelimitador(res.delimitador ?? '')}</span>{separador ? '' : ' (detectado)'}{res.codificacion ? ` · ${res.codificacion}` : ''}</>
                    : 'Archivo de Excel (.xlsx)'}</p>
                  {res.formato === 'CSV' && (
                    <div className="w-48"><Field label="Separador" id="cargue-sep">
                      <Select id="cargue-sep" value={separador} disabled={cargando} onChange={(e) => cambiarSeparador(e.target.value)}>
                        <option value="">Automático</option>
                        {DELIMITADORES.map((d) => <option key={d.nombre} value={sepApi(d.valor)}>{d.nombre[0].toUpperCase() + d.nombre.slice(1)}</option>)}
                      </Select>
                    </Field></div>
                  )}
                </div>
                {res.avisos?.map((a) => <p key={a} className="flex items-start gap-2 rounded-lg bg-warn/10 px-3 py-2 text-[13px] text-warn"><AlertTriangle size={16} className="mt-px shrink-0" />{a}</p>)}
                {res.faltantes.length > 0 && <p className="flex items-start gap-2 rounded-lg bg-bad/10 px-3 py-2 text-[13px] text-bad"><XCircle size={16} className="mt-px shrink-0" />Faltan columnas obligatorias en el archivo: {res.faltantes.join(', ')}. Use la plantilla sin cambiar los encabezados.{res.formato === 'CSV' ? ' Si las columnas sí están, elija otro separador.' : ''}</p>}
                <div className="grid grid-cols-3 gap-2">
                  <div className="rounded-lg bg-surface-2 p-3"><p className="num font-display text-[22px] font-semibold">{res.filas.length}</p><p className="text-[12px] text-muted">filas leídas</p></div>
                  <div className="rounded-lg bg-ok/10 p-3 text-ok"><p className="num font-display text-[22px] font-semibold">{validas.length}</p><p className="text-[12px]">listas para cargar</p></div>
                  <div className="rounded-lg bg-bad/10 p-3 text-bad"><p className="num font-display text-[22px] font-semibold">{conError.length}</p><p className="text-[12px]">con errores</p></div>
                </div>
                <Tabs value={vista} onChange={setVista} items={[{ value: 'todas', label: 'Todas', count: res.filas.length }, { value: 'errores', label: 'Con errores', count: conError.length }, { value: 'validas', label: 'Válidas', count: validas.length }]} />
              </div>
              <ul className="divide-y divide-line border-t border-line">
                {visibles.map((f) => (
                  <li key={f.n} className="flex gap-3 px-4 py-3">
                    {f.errores.length ? <XCircle size={18} className="mt-0.5 shrink-0 text-bad" /> : f.advertencias.length ? <AlertTriangle size={18} className="mt-0.5 shrink-0 text-warn" /> : <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-ok" />}
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px]"><span className="num mr-2 rounded bg-surface-2 px-1.5 py-0.5 text-[12px] font-semibold text-muted">Fila {f.n}</span><span className="font-medium">{resumen(f) || '(vacía)'}</span></p>
                      {f.errores.map((e) => <p key={e} className="mt-1 text-[13px] text-bad">{e}</p>)}
                      {f.advertencias.map((e) => <p key={e} className="mt-1 text-[13px] text-warn">{e}</p>)}
                    </div>
                  </li>
                ))}
                {!visibles.length && <li className="px-4 py-6 text-center text-muted">No hay filas en esta vista.</li>}
              </ul>
              <div className="flex flex-wrap justify-end gap-2 border-t border-line px-4 py-3">
                {conError.length > 0 && <Button onClick={bajarErrores}><Download size={16} /> Descargar filas con errores</Button>}
                <Button variant="primary" disabled={!validas.length || res.faltantes.length > 0 || cargando} onClick={cargar}><Upload size={16} /> Cargar {validas.length} filas válidas</Button>
              </div>
            </Card>
          )}

          <Card title={<span className="flex items-center gap-2"><History size={17} />Importaciones anteriores</span>} pad={false}>
            <ul className="divide-y divide-line">{historial.map((h, i) => (
              <li key={h.id ?? i} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-[13px]">
                <span className="num text-muted">{h.fecha}</span><span className="font-medium">{h.plantilla}</span>
                <span className="min-w-0 flex-1 truncate text-muted">{h.archivo}{h.formato === 'CSV' ? ` · CSV (${nombreDelimitador(h.delimitador ?? '')})` : ''}{h.usuario ? ` · ${h.usuario}` : ''}</span>
                {h.estado === 'REVERTIDO' ? <Badge tone="neutral">Deshecho</Badge> : <Badge tone="ok">{cuantas(h.ok, ['cargada', 'cargadas'])}</Badge>}
                {h.error > 0 && <Badge tone="bad">{cuantas(h.error, ['rechazada', 'rechazadas'])}</Badge>}
                {puedeDeshacer(h) && <Button size="sm" variant="ghost" onClick={() => abrirDeshacer(h)}><Undo2 size={14} /> Deshacer</Button>}
                {h.estado === 'REVERTIDO' && <p className="w-full text-[12px] text-muted">Deshecho{h.revertidoEn ? ` el ${fmtFechaHora(h.revertidoEn)}` : ''}{h.revertidoPor ? ` por ${h.revertidoPor}` : ''}: {h.motivoReversion}. Sus declaraciones quedaron anuladas.</p>}
              </li>))}
              {!historial.length && <li className="px-4 py-6 text-center text-muted">Todavía no hay importaciones.</li>}
            </ul>
          </Card>
          {!MODO_REAL && <p className="flex items-start gap-2 text-[12px] text-muted"><Info size={14} className="mt-px shrink-0" />Modo demostración: la revisión se hace en el navegador contra datos de ejemplo y nada se guarda. Con el servidor conectado, la revisión y el guardado los hace el API.</p>}
        </div>
      </div>

      <Sheet open={!!deshacer} onClose={cerrarDeshacer} title={<span className="flex items-center gap-2"><Undo2 size={17} className="text-bad" />Deshacer el cargue</span>}
        footer={impacto?.puede
          ? <><Button onClick={cerrarDeshacer}>Cancelar</Button><Button variant="danger" disabled={motivo.trim().length < 10 || enviando} onClick={confirmarDeshacer}>{enviando ? <Loader2 size={16} className="animate-spin" /> : <Undo2 size={16} />} Anular {impacto.declaraciones} {impacto.declaraciones === 1 ? 'declaración' : 'declaraciones'}</Button></>
          : <Button onClick={cerrarDeshacer}>Cerrar</Button>}>
        {!impacto ? <p className="flex items-center gap-2 text-muted"><Loader2 size={16} className="animate-spin" />Revisando el cargue…</p> : (
          <div className="flex flex-col gap-4 text-[14px]">
            <p><span className="font-medium">«{impacto.cargue.archivo}»</span>, cargado el {fmtFechaHora(impacto.cargue.creadoEn)}{deshacer?.usuario ? ` por ${deshacer.usuario}` : ''}.</p>
            <p className="text-[13px] text-muted">Nada se borra: las declaraciones de este cargue quedan <span className="font-semibold text-fg">anuladas</span>, inactivas y como constancia, y sus códigos internos quedan libres para volver a cargar el archivo corregido. La auditoría guarda quién lo hizo y por qué.</p>
            <div className="rounded-lg bg-surface-2 p-3">
              <p className="font-medium">{impacto.declaraciones} {impacto.declaraciones === 1 ? 'declaración' : 'declaraciones'} del cargue</p>
              <p className="text-[13px] text-muted">{Object.entries(impacto.porEstado).map(([e, n]) => cuantas(n, ESTADO_EN[e] ?? [e.toLowerCase(), e.toLowerCase()])).join(' · ')}</p>
              <ul className="mt-2 max-h-56 overflow-y-auto text-[13px]">
                {impacto.lista.slice(0, 50).map((d) => (
                  <li key={d.numero} className="flex items-center gap-2 py-0.5"><span className="num shrink-0 text-muted">N.° {d.numero}</span><span className="min-w-0 flex-1 truncate">{d.codigoInterno ? `${d.codigoInterno} · ` : ''}{d.nombre}</span><EstadoBadge estado={d.estado} /></li>
                ))}
              </ul>
              {impacto.lista.length > 50 && <p className="mt-1 text-[12px] text-muted">y {impacto.lista.length - 50} más</p>}
            </div>
            {impacto.puede && autorizadas > 0 && <p className="flex items-start gap-2 rounded-lg bg-warn/10 px-3 py-2 text-[13px] text-warn"><AlertTriangle size={16} className="mt-px shrink-0" />{autorizadas === 1 ? 'Una ya está autorizada' : `${autorizadas} ya están autorizadas`}: también {autorizadas === 1 ? 'quedará anulada' : 'quedarán anuladas'} y no se {autorizadas === 1 ? 'podrá' : 'podrán'} programar.</p>}
            {!impacto.puede && <p className="flex items-start gap-2 rounded-lg bg-bad/10 px-3 py-2 text-[13px] text-bad"><XCircle size={16} className="mt-px shrink-0" />{impacto.impedimento}</p>}
            {impacto.enUso.length > 0 && (
              <ul className="text-[13px] text-muted">{impacto.enUso.slice(0, 20).map((d) => <li key={d.numero}>N.° {d.numero} · {d.nombre}: {d.solicitudes} en solicitudes, {d.manifiestos} en manifiestos</li>)}</ul>
            )}
            {impacto.puede && (
              <Field label="Motivo (queda en la auditoría)" id="deshacer-motivo" hint="Mínimo 10 caracteres. Por ejemplo: «Archivo con los precios equivocados».">
                <textarea id="deshacer-motivo" value={motivo} maxLength={300} onChange={(e) => setMotivo(e.target.value)} className={areaCls} placeholder="¿Por qué se deshace este cargue?" />
              </Field>
            )}
          </div>
        )}
      </Sheet>
    </>
  );
}
