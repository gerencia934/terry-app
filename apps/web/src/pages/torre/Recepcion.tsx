// Recepción en planta (documentos reales §2): descarga de un transportador externo con empresa y NIT, conductor con
// ARL y EPS, horas, báscula, firma del receptor de Terra Viva y del conductor o cliente, recibo angosto y manifiesto
// en PDF con el mismo número (TV####).
import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, FileText, Plus, Printer, RefreshCw, Save, Trash2, Truck } from 'lucide-react';
import { ResponsiveTable, type Column } from '../../components/data';
import { Badge, Button, Card, EstadoBadge, Field, Input, PageHeader, Select, useToast } from '../../components/ui';
import { api, sesionActual, tienePermiso } from '../../lib/api';
import { fmtFechaCorta } from '../../lib/format';
import { cant, hoyCo, msg, sumarDias, useApi, usePaginado, PieLista, verPdf } from '../../lib/servidor';
import { Firma } from '../CampoServidor';
import { useCatalogos } from './comun';
import { BuscarCliente } from '../../components/BuscarCliente';

interface Descargue {
  id: string; numero: string; estado: string; fechaServicio: string; cliente: { razonSocial: string }; realizadoEn: string | null;
  transporte: { placa: string | null; empresaTransportadora: string } | null; lineas: number; sedes: string[];
}
interface Decl {
  id: string; nombre: string; codigoInterno: string | null; sucursales: { activa: boolean; sucursal: { id: string; codigo: string | null; nombre: string } }[];
  tarifaVigente: { metrica: { abreviacion: string } | null } | null;
}
interface Linea { sucursalId: string; declaracionId: string; cantidad: string; embalajes: string }
const ahoraLocal = (minutos = 0) => { const d = new Date(Date.now() + minutos * 60_000); return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16); };
const formVacio = () => ({
  clienteId: '', empresa: '', nit: '', placa: '', tipoVehiculo: '', conductor: '', conductorDoc: '', arlId: '', epsId: '', auxiliar: '', telefono: '',
  llegada: ahoraLocal(-30), salida: ahoraLocal(), entrada: '', salidaKg: '', observaciones: '',
  receptorNombre: sesionActual()?.usuario.nombre ?? '', receptorDoc: '', firmaReceptor: '', entregaNombre: '', entregaDoc: '', firmaEntrega: '',
});

export function RecepcionPlantaServidor() {
  const [nueva, setNueva] = useState(false);
  const hoy = hoyCo();
  const lista = usePaginado<Descargue>(`/manifiestos?tipo=DESCARGUE&desde=${sumarDias(hoy, -7)}&hasta=${sumarDias(hoy, 1)}`);
  if (nueva) return <NuevaRecepcion volver={() => { setNueva(false); lista.recargar(); }} />;
  const imprimir = (m: Descargue, recibo: boolean) => verPdf(`/manifiestos/${m.id}/${recibo ? 'recibo' : 'pdf'}`).catch(() => undefined);
  const cols: Column<Descargue>[] = [
    { key: 'num', header: 'Número', render: (m) => <span className="num font-medium">{m.numero}</span>, priority: 3 },
    { key: 'f', header: 'Fecha', render: (m) => <span className="num">{fmtFechaCorta(m.fechaServicio)}</span>, priority: 1 },
    { key: 'cli', header: 'Cliente', render: (m) => <span className="block max-w-[220px] truncate">{m.cliente.razonSocial}</span>, priority: 3 },
    { key: 'tr', header: 'Transportador', render: (m) => <span className="block max-w-[200px] truncate">{m.transporte ? `${m.transporte.empresaTransportadora} · ${m.transporte.placa ?? 'sin placa'}` : '—'}</span>, priority: 2 },
    { key: 'gen', header: 'Generadores', render: (m) => <span className="block max-w-[180px] truncate">{m.sedes.join(', ')}</span>, priority: 3 },
    { key: 'est', header: 'Estado', render: (m) => <EstadoBadge estado={m.estado} />, priority: 3 },
    { key: 'doc', header: 'Documentos', render: (m) => (m.estado === 'REALIZADO'
      ? <span className="flex gap-1" onClick={(e) => e.stopPropagation()}><Button size="sm" variant="ghost" onClick={() => imprimir(m, true)}><Printer size={14} /> Recibo</Button><Button size="sm" variant="ghost" onClick={() => imprimir(m, false)}><FileText size={14} /> PDF</Button></span>
      : '—'), priority: 2 },
  ];
  return (
    <>
      <PageHeader eyebrow="Planta Los Pinos" title="Recepción en planta" subtitle="Descargas de transportadores externos: datos del vehículo y del conductor, báscula y firmas del receptor y de quien entrega. Al grabar sale el recibo para la impresora térmica."
        actions={<>{tienePermiso('manifiestos.operar') && <Button variant="primary" onClick={() => setNueva(true)}><Plus size={16} /> Nueva recepción</Button>}<Button onClick={lista.recargar}><RefreshCw size={16} /> Actualizar</Button></>} />
      {lista.error ? <p className="rounded-xl bg-bad/10 p-4 text-bad">{lista.error}</p>
        : !lista.filas ? <p className="p-6 text-center text-muted">Cargando…</p>
        : <ResponsiveTable rows={lista.filas} footer={<PieLista mostradas={lista.filas.length} total={lista.total} hayMas={lista.hayMas} cargando={lista.cargando} cargarMas={lista.cargarMas} />} columns={cols} rowKey={(m) => m.id} cardTitle={(m) => <span className="num">{m.numero}</span>} cardBadge={(m) => <EstadoBadge estado={m.estado} />}
            cardMeta={(m) => `${m.cliente.razonSocial} · ${m.transporte?.placa ?? ''}`} empty="No hay descargas en los últimos 7 días." />}
    </>
  );
}

function NuevaRecepcion({ volver }: { volver: () => void }) {
  const toast = useToast();
  const cat = useCatalogos();
  const [f, setF] = useState(formVacio);
  const [lineas, setLineas] = useState<Linea[]>([{ sucursalId: '', declaracionId: '', cantidad: '', embalajes: '' }]);
  const [manifiestoId, setManifiestoId] = useState<string | null>(null); // si el grabado falla, se reintenta sin crear otro
  const [listo, setListo] = useState<{ id: string; numero: string } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  // En planta se reciben residuos (no servicios) y solo no peligrosos: Los Pinos no recibe RESPEL (Res. DGL 000632 de 2023, art. 6)
  const decls = useApi<{ filas: Decl[] }>(f.clienteId ? `/declaraciones?clienteId=${f.clienteId}&tipo=RESIDUO&estado=AUTORIZADA&activa=true&peligroso=false&porPagina=200` : null);
  useEffect(() => { if (!manifiestoId) setLineas([{ sucursalId: '', declaracionId: '', cantidad: '', embalajes: '' }]); }, [f.clienteId]); // eslint-disable-line react-hooks/exhaustive-deps
  const sedes = useMemo(() => [...new Map((decls.datos?.filas ?? []).flatMap((d) => d.sucursales.filter((s) => s.activa).map((s) => [s.sucursal.id, s.sucursal] as const))).values()], [decls.datos]);
  const set = (k: keyof ReturnType<typeof formVacio>) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }));
  const neto = f.entrada && f.salidaKg ? Number(f.entrada) - Number(f.salidaKg) : null;
  const lineasOk = lineas.filter((l) => l.sucursalId && l.declaracionId && Number(l.cantidad) > 0);
  const faltan = [
    !f.clienteId && 'el cliente', !lineasOk.length && 'al menos un residuo con cantidad', f.empresa.trim().length < 2 && 'la empresa transportadora',
    !f.conductor.trim() && 'el conductor', (!f.arlId || !f.epsId) && 'la ARL y la EPS del conductor', (neto === null || neto < 0) && 'la báscula (entrada mayor que salida)',
    !f.firmaReceptor && 'la firma del receptor', !f.firmaEntrega && 'la firma de quien entrega', f.entregaNombre.trim().length < 3 && 'el nombre de quien entrega',
    f.entregaDoc.trim().length < 3 && 'el documento de quien entrega', f.receptorNombre.trim().length < 3 && 'el nombre del receptor',
  ].filter(Boolean) as string[];

  const grabar = async () => {
    setOcupado(true);
    try {
      let id = manifiestoId;
      if (!id) {
        const m = await api<{ id: string; numero: string }>('/manifiestos', { cuerpo: {
          tipo: 'DESCARGUE', clienteId: f.clienteId, fechaServicio: hoyCo(), observaciones: f.observaciones.trim() || undefined,
          transporte: { empresaTransportadora: f.empresa.trim(), nit: f.nit.trim() || undefined, placa: f.placa.trim() || undefined, tipoVehiculo: f.tipoVehiculo.trim() || undefined,
            conductorNombre: f.conductor.trim(), conductorDocumento: f.conductorDoc.trim() || undefined, conductorArlId: f.arlId, conductorEpsId: f.epsId,
            auxiliarNombre: f.auxiliar.trim() || undefined, telefono: f.telefono.trim() || undefined },
          items: lineasOk.map((l) => ({ declaracionId: l.declaracionId, sucursalId: l.sucursalId, cantidad: Number(l.cantidad), embalajes: l.embalajes ? Number(l.embalajes) : undefined })),
        } });
        id = m.id; setManifiestoId(m.id);
      }
      const r = await api<{ id: string; numero: string }>(`/manifiestos/${id}/grabar`, { cuerpo: {
        firma: f.firmaEntrega, firmaNombre: f.entregaNombre.trim(), firmaDocumento: f.entregaDoc.trim(),
        firmaReceptor: f.firmaReceptor, receptorNombre: f.receptorNombre.trim(), receptorDocumento: f.receptorDoc.trim() || undefined,
        horaLlegada: new Date(f.llegada).toISOString(), horaSalida: new Date(f.salida).toISOString(),
        pesoEntrada: Number(f.entrada), pesoSalida: Number(f.salidaKg), observaciones: f.observaciones.trim() || undefined,
      } });
      setListo({ id: r.id, numero: r.numero });
      toast(`Recepción ${r.numero} grabada.`);
    } catch (e) { toast(msg(e), 'warn'); } finally { setOcupado(false); }
  };

  if (listo) return (
    <div className="mx-auto flex max-w-lg flex-col items-center gap-4 py-10 text-center">
      <Truck size={40} className="text-ok" />
      <h1 className="text-xl font-semibold">Recepción <span className="num">{listo.numero}</span> grabada</h1>
      <p className="text-muted">Entregue el recibo al conductor. El manifiesto completo lleva el mismo número y ya abrió su conciliación.</p>
      <div className="flex flex-wrap justify-center gap-2">
        <Button variant="primary" onClick={() => verPdf(`/manifiestos/${listo.id}/recibo`).catch((e) => toast(msg(e), 'warn'))}><Printer size={16} /> Imprimir recibo</Button>
        <Button onClick={() => verPdf(`/manifiestos/${listo.id}/pdf`).catch((e) => toast(msg(e), 'warn'))}><FileText size={16} /> Manifiesto PDF</Button>
        <Button variant="ghost" onClick={volver}>Volver a la lista</Button>
      </div>
    </div>
  );

  return (
    <>
      <div className="mb-3"><Button variant="ghost" size="sm" onClick={volver}><ArrowLeft size={16} /> Recepción en planta</Button></div>
      <PageHeader eyebrow="Planta Los Pinos" title="Nueva recepción" subtitle="Diligencie mientras el vehículo está en báscula. Si algo falta, el sistema le dice qué antes de grabar." />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card title="1. Cliente y residuos">
          <div className="flex flex-col gap-3">
            <Field label="Cliente" id="rp-c"><BuscarCliente id="rp-c" valor={f.clienteId} disabled={!!manifiestoId} vacio="Escriba el nombre o el NIT" onChange={(c) => setF((s) => ({ ...s, clienteId: c?.id ?? '' }))} /></Field>
            {f.clienteId && decls.datos && !sedes.length && <p className="rounded-lg bg-warn/10 px-3 py-2 text-[13px] text-warn">El cliente no tiene declaraciones autorizadas y activas de residuos no peligrosos (Los Pinos no recibe residuos peligrosos).</p>}
            {lineas.map((l, i) => {
              const delaSede = (decls.datos?.filas ?? []).filter((d) => d.sucursales.some((s) => s.activa && s.sucursal.id === l.sucursalId));
              const unidad = delaSede.find((d) => d.id === l.declaracionId)?.tarifaVigente?.metrica?.abreviacion ?? '';
              const cambiar = (c: Partial<Linea>) => setLineas((xs) => xs.map((x, j) => (j === i ? { ...x, ...c } : x)));
              return (
                <div key={i} className="grid grid-cols-1 gap-2 rounded-xl border border-line p-3 sm:grid-cols-[1fr_1fr_110px_90px_auto]">
                  <Select aria-label="Generador (sede)" value={l.sucursalId} disabled={!!manifiestoId} onChange={(e) => cambiar({ sucursalId: e.target.value, declaracionId: '' })}><option value="">Generador…</option>{sedes.map((s) => <option key={s.id} value={s.id}>{s.codigo ? `${s.codigo} · ` : ''}{s.nombre}</option>)}</Select>
                  <Select aria-label="Residuo" value={l.declaracionId} disabled={!!manifiestoId || !l.sucursalId} onChange={(e) => cambiar({ declaracionId: e.target.value })}><option value="">Residuo…</option>{delaSede.map((d) => <option key={d.id} value={d.id}>{d.nombre}{d.codigoInterno ? ` (${d.codigoInterno})` : ''}</option>)}</Select>
                  <Input aria-label={`Cantidad${unidad ? ` en ${unidad}` : ''}`} type="number" min={0} step="0.01" placeholder={`Cantidad${unidad ? ` (${unidad})` : ''}`} value={l.cantidad} disabled={!!manifiestoId} onChange={(e) => cambiar({ cantidad: e.target.value })} />
                  <Input aria-label="Embalajes" type="number" min={0} placeholder="Embalajes" value={l.embalajes} disabled={!!manifiestoId} onChange={(e) => cambiar({ embalajes: e.target.value })} />
                  <Button size="sm" variant="ghost" disabled={!!manifiestoId || lineas.length === 1} onClick={() => setLineas((xs) => xs.filter((_, j) => j !== i))} aria-label="Quitar el residuo"><Trash2 size={15} /></Button>
                </div>
              );
            })}
            {!manifiestoId && <Button size="sm" className="self-start" disabled={!f.clienteId} onClick={() => setLineas((xs) => [...xs, { sucursalId: '', declaracionId: '', cantidad: '', embalajes: '' }])}><Plus size={14} /> Otro residuo o generador</Button>}
          </div>
        </Card>

        <Card title="2. Transportador externo">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Empresa transportadora" id="rp-e"><Input id="rp-e" value={f.empresa} disabled={!!manifiestoId} onChange={set('empresa')} /></Field>
            <Field label="NIT (sin dígito de verificación)" id="rp-n"><Input id="rp-n" inputMode="numeric" value={f.nit} disabled={!!manifiestoId} onChange={(e) => setF((s) => ({ ...s, nit: e.target.value.replace(/\D/g, '') }))} /></Field>
            <Field label="Placa" id="rp-p"><Input id="rp-p" value={f.placa} disabled={!!manifiestoId} onChange={(e) => setF((s) => ({ ...s, placa: e.target.value.toUpperCase() }))} placeholder="ABC123" /></Field>
            <Field label="Tipo de vehículo" id="rp-t"><Input id="rp-t" value={f.tipoVehiculo} disabled={!!manifiestoId} onChange={set('tipoVehiculo')} placeholder="Vacuum, volqueta…" /></Field>
            <Field label="Conductor" id="rp-cd"><Input id="rp-cd" value={f.conductor} disabled={!!manifiestoId} onChange={set('conductor')} /></Field>
            <Field label="Documento del conductor" id="rp-cdd"><Input id="rp-cdd" value={f.conductorDoc} disabled={!!manifiestoId} onChange={set('conductorDoc')} /></Field>
            <Field label="ARL del conductor" id="rp-arl"><Select id="rp-arl" value={f.arlId} disabled={!!manifiestoId} onChange={set('arlId')}><option value="">Elija la ARL</option>{cat?.arl.map((x) => <option key={x.id} value={x.id}>{x.nombre}</option>)}</Select></Field>
            <Field label="EPS del conductor" id="rp-eps"><Select id="rp-eps" value={f.epsId} disabled={!!manifiestoId} onChange={set('epsId')}><option value="">Elija la EPS</option>{cat?.eps.map((x) => <option key={x.id} value={x.id}>{x.nombre}</option>)}</Select></Field>
            <Field label="Auxiliar" id="rp-aux" hint="Opcional"><Input id="rp-aux" value={f.auxiliar} disabled={!!manifiestoId} onChange={set('auxiliar')} /></Field>
            <Field label="Teléfono" id="rp-tel" hint="Opcional"><Input id="rp-tel" value={f.telefono} disabled={!!manifiestoId} onChange={set('telefono')} /></Field>
          </div>
        </Card>

        <Card title="3. Horas y báscula">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Llegada" id="rp-ll"><Input id="rp-ll" type="datetime-local" value={f.llegada} onChange={set('llegada')} /></Field>
            <Field label="Salida" id="rp-sa"><Input id="rp-sa" type="datetime-local" value={f.salida} onChange={set('salida')} /></Field>
            <Field label="Peso de entrada, lleno (kg)" id="rp-pe"><Input id="rp-pe" type="number" min={0} step="0.01" value={f.entrada} onChange={set('entrada')} /></Field>
            <Field label="Peso de salida, vacío (kg)" id="rp-ps"><Input id="rp-ps" type="number" min={0} step="0.01" value={f.salidaKg} onChange={set('salidaKg')} /></Field>
          </div>
          <p className="mt-3 text-sm">Neto: <b className="num">{neto === null ? '—' : `${cant(neto)} kg`}</b>{neto !== null && neto < 0 && <Badge tone="bad">La salida no puede ser mayor que la entrada</Badge>}</p>
          <div className="mt-3"><Field label="Observaciones" id="rp-o"><Input id="rp-o" value={f.observaciones} onChange={set('observaciones')} maxLength={2000} /></Field></div>
        </Card>

        <Card title="4. Firmas">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <p className="text-[13px] font-semibold">Recibe por Terra Viva</p>
              <Input aria-label="Nombre del receptor" value={f.receptorNombre} onChange={set('receptorNombre')} placeholder="Nombre" />
              <Input aria-label="Documento del receptor" value={f.receptorDoc} onChange={set('receptorDoc')} placeholder="Documento" />
              <Firma valor={f.firmaReceptor} onChange={(v) => setF((s) => ({ ...s, firmaReceptor: v }))} />
            </div>
            <div className="flex flex-col gap-2">
              <p className="text-[13px] font-semibold">Entrega (conductor o cliente)</p>
              <Input aria-label="Nombre de quien entrega" value={f.entregaNombre} onChange={set('entregaNombre')} placeholder={f.conductor || 'Nombre'} />
              <Input aria-label="Documento de quien entrega" value={f.entregaDoc} onChange={set('entregaDoc')} placeholder={f.conductorDoc || 'Documento'} />
              <Firma valor={f.firmaEntrega} onChange={(v) => setF((s) => ({ ...s, firmaEntrega: v }))} />
            </div>
          </div>
        </Card>
      </div>
      <div className="sticky bottom-3 z-20 mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-surface px-4 py-3 shadow-lg">
        <p className="min-w-0 flex-1 text-[13px] text-muted">{faltan.length ? <>Falta: {faltan.join(', ')}.</> : manifiestoId ? 'El manifiesto ya se creó: corrija lo indicado y vuelva a grabar.' : 'Todo listo para grabar.'}</p>
        <Button variant="primary" disabled={ocupado || faltan.length > 0} onClick={grabar}><Save size={16} /> Grabar recepción</Button>
      </div>
      {manifiestoId && <p className="mt-2 text-[12px] text-subtle">El manifiesto ya existe: si al final no se puede grabar, anúlelo desde Manifiestos.</p>}
    </>
  );
}
