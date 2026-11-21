// Manifiesto impreso en sitio desde el celular (gerencia, 20-11-2026: «el de conductores se ve solo en el celular e
// imprime el manifiesto en sitio»). Se arma con lo que ya está en el teléfono, así que sirve SIN SEÑAL: el número llega con
// la ruta del día y lo diligenciado queda guardado al grabar. El contenido es el del PDF oficial del servidor (mismo
// número); el servidor guarda el oficial cuando el manifiesto llega.
//
// Dos formatos: tiquete de 80 mm (impresora térmica portátil por Bluetooth) y carta. Se imprime con el diálogo del
// teléfono (window.print): en Android, la impresora portátil aparece si tiene instalado su servicio de impresión.
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

export type FormatoImpresion = 'TIQUETE' | 'CARTA';
export interface DatosImpresion {
  numero: string; fechaServicio: string; anulado?: string | null;
  emisor: { razonSocial: string; nit: string; notaBascula: string | null };
  cliente: { razonSocial: string; nit: string };
  destino: string; ruta: string | null; ordenCompra: string | null;
  transporte: { empresa: string; nit: string | null; placa: string | null; tipoVehiculo: string | null; conductor: string | null; conductorDocumento: string | null; auxiliar: string | null };
  horaLlegada: string | null; horaSalida: string | null;
  bascula: { entrada: number | null; salida: number | null; neto: number | null };
  lineas: { generador: string; generadorNit: string | null; residuo: string; peligroso: boolean; corrientes: string[]; cantidad: number; unidad: string; embalajes: string | null; tratamiento: string }[];
  noRecogidos: string[];
  observaciones: string | null;
  firma: { nombre: string | null; documento: string | null; imagen: string | null };
  grabadoEn: string | null; copia: string;
}

const PREF = 'terry-go-formato-impresion';
export const formatoGuardado = (): FormatoImpresion => { try { return localStorage.getItem(PREF) === 'CARTA' ? 'CARTA' : 'TIQUETE'; } catch { return 'TIQUETE'; } };
const recordarFormato = (f: FormatoImpresion) => { try { localStorage.setItem(PREF, f); } catch { /* sin almacenamiento */ } };

const fecha = (iso: string) => { const [a, m, d] = iso.slice(0, 10).split('-'); return `${d}/${m}/${a}`; };
const hora = (iso: string | null) => (iso ? new Date(iso).toLocaleString('es-CO', { timeZone: 'America/Bogota', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }) : '—');
const num = (v: number | null) => (v === null ? '—' : v.toLocaleString('es-CO', { maximumFractionDigits: 2 }));

/** Imprime un manifiesto: lo pinta en un contenedor que solo se ve al imprimir y abre el diálogo del teléfono. */
export function useImprimir() {
  const [trabajo, setTrabajo] = useState<{ datos: DatosImpresion; formato: FormatoImpresion } | null>(null);
  useEffect(() => {
    if (!trabajo) return;
    const pagina = document.createElement('style');
    pagina.textContent = trabajo.formato === 'TIQUETE' ? '@page { size: 80mm auto; margin: 3mm; }' : '@page { size: letter; margin: 14mm; }';
    document.head.appendChild(pagina);
    const t = window.setTimeout(() => { window.print(); }, 60); // deja pintar antes de abrir el diálogo
    const fin = () => setTrabajo(null);
    window.addEventListener('afterprint', fin, { once: true });
    return () => { window.clearTimeout(t); pagina.remove(); window.removeEventListener('afterprint', fin); };
  }, [trabajo]);
  const imprimir = (datos: DatosImpresion, formato: FormatoImpresion) => { recordarFormato(formato); setTrabajo({ datos, formato }); };
  const elemento = trabajo ? createPortal(<div id="impresion"><ManifiestoImpreso datos={trabajo.datos} formato={trabajo.formato} /></div>, document.body) : null;
  return { imprimir, elemento };
}

/** El manifiesto en papel: mismas secciones que el PDF oficial (generador, transporte, báscula, residuos, firmas). */
export function ManifiestoImpreso({ datos: d, formato }: { datos: DatosImpresion; formato: FormatoImpresion }) {
  const tiquete = formato === 'TIQUETE';
  const base = tiquete ? { fontFamily: 'Arial, Helvetica, sans-serif', fontSize: '11px', width: '72mm', lineHeight: 1.3 } : { fontFamily: 'Arial, Helvetica, sans-serif', fontSize: '12px', lineHeight: 1.35 };
  const titulo = { fontWeight: 700, fontSize: tiquete ? '12px' : '15px', margin: '6px 0 2px' } as const;
  const seccion = { fontWeight: 700, borderBottom: '1px solid #000', margin: '8px 0 3px', paddingBottom: '1px', fontSize: tiquete ? '11px' : '13px' } as const;
  const par = (k: string, v: string | null | undefined) => (
    <div style={{ display: 'flex', gap: '6px', justifyContent: 'space-between' }}><span style={{ color: '#333' }}>{k}</span><span style={{ textAlign: 'right', fontWeight: 600 }}>{v || '—'}</span></div>
  );
  return (
    <div style={base}>
      <div style={{ textAlign: tiquete ? 'center' : 'left' }}>
        <div style={{ fontWeight: 700, fontSize: tiquete ? '12px' : '16px' }}>{d.emisor.razonSocial}</div>
        <div>NIT {d.emisor.nit}</div>
        <div style={titulo}>MANIFIESTO DE TRANSPORTE DE RESIDUOS</div>
        <div style={{ fontWeight: 700, fontSize: tiquete ? '16px' : '20px' }}>{d.numero}</div>
        <div>Servicio: {fecha(d.fechaServicio)}{d.ruta ? ` · Ruta ${d.ruta}` : ''}</div>
        {d.anulado && <div style={{ fontWeight: 700 }}>ANULADO · {d.anulado}</div>}
        <div style={{ fontSize: '10px' }}>{d.copia}</div>
      </div>

      <div style={seccion}>Generador y destino</div>
      {par('Cliente', d.cliente.razonSocial)}
      {par('NIT', d.cliente.nit)}
      {par('Destino', d.destino)}
      {d.ordenCompra && par('Orden de compra', d.ordenCompra)}

      <div style={seccion}>Transporte</div>
      {par('Transportador', `${d.transporte.empresa}${d.transporte.nit ? ` · NIT ${d.transporte.nit}` : ''}`)}
      {par('Vehículo', [d.transporte.placa, d.transporte.tipoVehiculo].filter(Boolean).join(' · '))}
      {par('Conductor', `${d.transporte.conductor ?? '—'}${d.transporte.conductorDocumento ? ` · CC ${d.transporte.conductorDocumento}` : ''}`)}
      {d.transporte.auxiliar && par('Auxiliar', d.transporte.auxiliar)}
      {par('Llegada', hora(d.horaLlegada))}
      {par('Salida', hora(d.horaSalida))}

      {(d.bascula.entrada !== null || d.bascula.salida !== null) && <>
        <div style={seccion}>Báscula (kg)</div>
        {par('Entrada (lleno)', num(d.bascula.entrada))}
        {par('Salida (vacío)', num(d.bascula.salida))}
        {par('Neto', num(d.bascula.neto))}
        {d.emisor.notaBascula && <div style={{ fontSize: '9px' }}>{d.emisor.notaBascula}</div>}
      </>}

      <div style={seccion}>Residuos</div>
      {d.lineas.map((l, i) => (
        <div key={i} style={{ borderBottom: '1px dashed #999', padding: '3px 0' }}>
          <div style={{ fontWeight: 700 }}>{l.residuo}{l.peligroso ? ' (RESPEL)' : ''}{l.corrientes.length ? ` · ${l.corrientes.join(', ')}` : ''}</div>
          {par('Cantidad', `${num(l.cantidad)} ${l.unidad}`)}
          {l.embalajes && par('Embalaje', l.embalajes)}
          {par('Tratamiento', l.tratamiento)}
          {par('Generador', `${l.generador}${l.generadorNit ? ` · NIT ${l.generadorNit}` : ''}`)}
        </div>
      ))}
      {d.noRecogidos.length > 0 && <>
        <div style={seccion}>No se recogió</div>
        {d.noRecogidos.map((x, i) => <div key={i}>{x}</div>)}
      </>}
      {d.observaciones && <>
        <div style={seccion}>Observaciones</div>
        <div style={{ whiteSpace: 'pre-wrap' }}>{d.observaciones}</div>
      </>}

      <div style={seccion}>Firma de quien entrega</div>
      {d.firma.imagen ? <img src={d.firma.imagen} alt="Firma" style={{ height: tiquete ? '60px' : '80px', maxWidth: '100%', objectFit: 'contain' }} /> : <div style={{ height: '40px' }} />}
      <div style={{ borderTop: '1px solid #000', paddingTop: '2px' }}>{[d.firma.nombre, d.firma.documento ? `CC ${d.firma.documento}` : null].filter(Boolean).join(' · ') || '—'}</div>
      <div style={{ marginTop: '10px', fontSize: '9px', textAlign: 'center' }}>
        {d.grabadoEn ? `Grabado el ${hora(d.grabadoEn)}. ` : ''}Generado en Terry-App Residuos. El manifiesto oficial (PDF) queda en el portal del cliente con el mismo número.
      </div>
    </div>
  );
}
