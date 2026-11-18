import { useEffect, useRef, useState, type DragEvent } from 'react';
import { Download, Upload, FileSpreadsheet, CheckCircle2, XCircle, AlertTriangle, PlayCircle, Loader2, History, Info } from 'lucide-react';
import { Badge, Button, Card, PageHeader, Tabs, useToast } from '../components/ui';
import { PLANTILLAS, plantilla, validarFilas, type FilaValidada, type Plantilla } from '@terraviva/shared';
import { contextoActual } from '../cargues/contexto';
import { cx } from '../lib/format';
import { MODO_REAL, api, ErrorApi } from '../lib/api';

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

interface Cargue { fecha: string; plantilla: string; archivo: string; ok: number; error: number }
const HISTORIAL_INICIAL: Cargue[] = [
  { fecha: '2026-11-12 09:41', plantilla: 'Clientes', archivo: 'clientes_noviembre.xlsx', ok: 14, error: 0 },
  { fecha: '2026-11-12 09:55', plantilla: 'Sedes de clientes', archivo: 'sedes_noviembre.xlsx', ok: 31, error: 2 },
  { fecha: '2026-11-05 16:20', plantilla: 'Tarifas', archivo: 'tarifas_2027.xlsx', ok: 58, error: 0 },
];

export default function Cargues() {
  const toast = useToast();
  const [pid, setPid] = useState('clientes');
  const [res, setRes] = useState<{ archivo: string; filas: FilaValidada[]; faltantes: string[] } | null>(null);
  const [cargando, setCargando] = useState(false);
  const [vista, setVista] = useState<'todas' | 'errores' | 'validas'>('todas');
  const [historial, setHistorial] = useState(MODO_REAL ? [] as Cargue[] : HISTORIAL_INICIAL);
  const [archivoActual, setArchivoActual] = useState<Blob | null>(null);
  const cargarHistorial = () => MODO_REAL && api<{ plantilla: string; archivo: string; filasOk: number; filasError: number; creadoEn: string }[]>('/importacion/historial')
    .then((h) => setHistorial(h.map((x) => ({ fecha: x.creadoEn.slice(0, 16).replace('T', ' '), plantilla: PLANTILLAS.find((q) => q.id === x.plantilla)?.nombre ?? x.plantilla, archivo: x.archivo, ok: x.filasOk, error: x.filasError })))).catch(() => undefined);
  useEffect(() => { cargarHistorial(); }, []);
  const [drag, setDrag] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const p = plantilla(pid);

  const elegir = (id: string) => { setPid(id); setRes(null); setVista('todas'); };
  const bajar = async () => {
    try {
      const { descargar } = await import('../cargues/descargar');
      if (MODO_REAL) descargar(await (await api<Blob>(`/importacion/plantillas/${p.id}/archivo`, { blob: true })).arrayBuffer(), p.archivo);
      else { const { construirPlantilla } = await import('@terraviva/shared'); descargar(await construirPlantilla(p), p.archivo); }
      toast(`Plantilla ${p.archivo} generada.`);
    }
    catch { toast('No se pudo generar la plantilla en este navegador.', 'warn'); }
  };
  const procesar = async (nombre: string, buf: ArrayBuffer) => {
    setCargando(true); setVista('todas');
    try {
      if (MODO_REAL) {
        // El servidor valida contra los datos reales de la empresa.
        const blob = new Blob([buf]); setArchivoActual(blob);
        const form = new FormData(); form.append('archivo', blob, nombre);
        const r = await api<{ archivo: string; filas: FilaValidada[]; faltantes: string[] }>(`/importacion/${p.id}/vista-previa`, { form });
        setRes({ archivo: r.archivo, filas: r.filas, faltantes: r.faltantes });
      } else {
        const { leerArchivo } = await import('@terraviva/shared');
        const { filas, faltantes } = await leerArchivo(p, buf);
        setRes({ archivo: nombre, filas: validarFilas(p, filas, contextoActual()), faltantes });
      }
    } catch (e) { toast(e instanceof ErrorApi ? e.message : 'No se pudo leer el archivo. Verifique que sea un .xlsx generado con la plantilla.', 'warn'); }
    setCargando(false);
  };
  const subir = async (f?: File | null) => { if (f) await procesar(f.name, await f.arrayBuffer()); };
  const probar = async () => {
    setCargando(true);
    const { construirPlantilla } = await import('@terraviva/shared');
    const ExcelJS = ((await import('exceljs')) as unknown as { default: typeof import('exceljs') }).default;
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(await construirPlantilla(p));
    const ws = wb.getWorksheet('Plantilla')!;
    (EJEMPLOS[p.id] ?? []).forEach((fila, i) => { ws.getRow(3 + i).values = p.columnas.map((c) => fila[c.key] ?? ''); });
    await procesar(`ejemplo_${p.id}.xlsx`, (await wb.xlsx.writeBuffer()) as ArrayBuffer);
  };
  const validas = res?.filas.filter((f) => !f.errores.length) ?? [];
  const conError = res?.filas.filter((f) => f.errores.length) ?? [];
  const cargar = async () => {
    if (!res) return;
    if (MODO_REAL && archivoActual) {
      try {
        const form = new FormData(); form.append('archivo', archivoActual, res.archivo);
        const r = await api<{ creadas: number; actualizadas: number; rechazadas: number }>(`/importacion/${p.id}/confirmar`, { form });
        toast(`Guardado: ${r.creadas} nuevos y ${r.actualizadas} actualizados.${r.rechazadas ? ` ${r.rechazadas} filas con errores quedaron por fuera.` : ''}`);
        setRes(null); cargarHistorial();
      } catch (e) { toast(e instanceof ErrorApi ? e.message : 'No se pudo guardar.', 'warn'); }
      return;
    }
    setHistorial((h) => [{ fecha: '2026-11-18 ' + new Date().toTimeString().slice(0, 5), plantilla: p.nombre, archivo: res.archivo, ok: validas.length, error: conError.length }, ...h]);
    toast(`Se cargaron ${validas.length} registros de «${p.nombre}». ${conError.length ? `${conError.length} filas con errores quedaron por fuera.` : ''}`);
    setRes(null);
  };
  const bajarErrores = async () => { const { exportarErrores } = await import('@terraviva/shared'); const { descargar } = await import('../cargues/descargar'); descargar(await exportarErrores(p, conError), `errores_${p.archivo}`); };
  const visibles = vista === 'errores' ? conError : vista === 'validas' ? validas : res?.filas ?? [];
  const resumen = (f: FilaValidada) => p.columnas.slice(0, 3).map((c) => f.datos[c.key]).filter(Boolean).join(' · ');

  return (
    <>
      <PageHeader eyebrow="Ajustes" title="Importar datos" subtitle="Descargue la plantilla, llénela en Excel y súbala. Cada fila se revisa antes de guardar y nada se guarda hasta que usted confirme." />
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
              <div className="flex shrink-0 flex-wrap gap-2"><Button onClick={bajar}><Download size={16} /> Descargar plantilla</Button><Button variant="primary" onClick={probar} disabled={cargando}><PlayCircle size={16} /> Probar con archivo de ejemplo</Button></div>
            </div>
            <details className="mt-4 rounded-lg border border-line">
              <summary className="cursor-pointer px-3 py-2 text-[13px] font-medium">Ver las {p.columnas.length} columnas de la plantilla</summary>
              <div className="scroll-x"><table className="w-full min-w-[620px] text-[13px]">
                <thead className="bg-surface-2 text-left text-[12px] uppercase tracking-[0.04em] text-muted"><tr><th className="px-3 py-2">Columna</th><th className="px-3 py-2">Obligatoria</th><th className="px-3 py-2">Formato</th><th className="px-3 py-2">Instrucción</th></tr></thead>
                <tbody>{p.columnas.map((c) => <tr key={c.key} className="border-t border-line"><td className="px-3 py-2 font-medium">{c.header}</td><td className="px-3 py-2">{c.requerido ? <Badge tone="brand">Sí</Badge> : <span className="text-muted">No</span>}</td><td className="px-3 py-2 text-muted">{c.opciones ? `Lista (${c.opciones.length})` : { texto: 'Texto', numero: 'Número', fecha: 'AAAA-MM-DD', lista: 'Lista', email: 'Correo', si_no: 'Sí / No' }[c.tipo]}</td><td className="px-3 py-2 text-muted">{c.ayuda || '—'}</td></tr>)}</tbody>
              </table></div>
            </details>
            <div onDragOver={(e: DragEvent) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={(e: DragEvent) => { e.preventDefault(); setDrag(false); subir(e.dataTransfer.files[0]); }}
              className={cx('mt-4 flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-8 text-center transition-colors', drag ? 'border-brand bg-brand-soft/50' : 'border-line')}>
              {cargando ? <Loader2 size={28} className="animate-spin text-brand" /> : <Upload size={28} className="text-brand" />}
              <p className="font-medium">{cargando ? 'Leyendo y validando…' : 'Arrastre aquí la plantilla diligenciada'}</p>
              <p className="text-[13px] text-muted">o</p>
              <Button onClick={() => input.current?.click()} disabled={cargando}>Elegir archivo .xlsx</Button>
              <input ref={input} id="cargue-archivo" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="sr-only" onChange={(e) => { subir(e.target.files?.[0]); e.target.value = ''; }} />
            </div>
          </Card>

          {res && (
            <Card title={<span className="flex items-center gap-2"><FileSpreadsheet size={17} className="text-brand" />Revisión de «{res.archivo}»</span>} pad={false}>
              <div className="flex flex-col gap-3 p-4">
                {res.faltantes.length > 0 && <p className="flex items-start gap-2 rounded-lg bg-bad/10 px-3 py-2 text-[13px] text-bad"><XCircle size={16} className="mt-px shrink-0" />Faltan columnas obligatorias en el archivo: {res.faltantes.join(', ')}. Use la plantilla sin cambiar los encabezados.</p>}
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
                <Button variant="primary" disabled={!validas.length || res.faltantes.length > 0} onClick={cargar}><Upload size={16} /> Cargar {validas.length} filas válidas</Button>
              </div>
            </Card>
          )}

          <Card title={<span className="flex items-center gap-2"><History size={17} />Importaciones anteriores</span>} pad={false}>
            <ul className="divide-y divide-line">{historial.map((h, i) => (
              <li key={i} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-[13px]">
                <span className="num text-muted">{h.fecha}</span><span className="font-medium">{h.plantilla}</span><span className="min-w-0 flex-1 truncate text-muted">{h.archivo}</span>
                <Badge tone="ok">{h.ok} cargadas</Badge>{h.error > 0 && <Badge tone="bad">{h.error} rechazadas</Badge>}
              </li>))}
            </ul>
          </Card>
          {!MODO_REAL && <p className="flex items-start gap-2 text-[12px] text-muted"><Info size={14} className="mt-px shrink-0" />Modo demostración: la revisión se hace en el navegador contra datos de ejemplo y nada se guarda. Con el servidor conectado, la revisión y el guardado los hace el API.</p>}
        </div>
      </div>
    </>
  );
}
