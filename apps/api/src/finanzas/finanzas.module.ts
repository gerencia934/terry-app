// Facturación con Siigo Nube (gerencia, 19-11-2026): trazabilidad financiera de los manifiestos.
// - Sincronización diaria (a la hora SIIGO_HORA de Colombia, una vez por día aunque haya varias copias del API) y botón
//   «Sincronizar con Siigo». Trae las facturas de venta y las notas crédito, las guarda en una copia local, las cruza con
//   los manifiestos (por el número que cita la factura y el NIT del cliente, o por el número de factura registrado en la
//   conciliación), pasa a las líneas de la conciliación el número, el vencimiento y el estado de pago, y recalcula si cada
//   manifiesto está facturado y pagado.
// - Panel de facturación, alertas de manifiestos sin facturar y regla del certificado de cada cliente.
// Solo Comercial, Facturación (financiero) y Gerencia: «finanzas.ver»; sincronizar, enlazar y marcar sin cobro:
// «finanzas.gestionar». Ni el portal ni la app de campo leen estas tablas (la base tampoco se lo permite al portal).
import {
  BadRequestException, Body, Controller, Delete, Get, HttpCode, Injectable, Logger, Module, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Query,
  type OnApplicationBootstrap, type OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, ReglaCertificado } from '@prisma/client';
import { z } from 'zod';
import { esExcepcionCertificado } from '@terraviva/shared';
import { PrismaService } from '../prisma/prisma.service';
import { Auditoria } from '../common/servicios';
import { ActorActual, Permiso, Zod, fechaColombia, paginar, type Actor } from '../common/http';
import type { Config } from '../config';
import { ErrorSiigo, SiigoCliente, estadoFactura, manifiestosCitados, venceFactura, type FacturaApi, type NotaCreditoApi } from './siigo';
import { recalcularFinanzas } from './estado';

const Filtros = z.object({
  estado: z.enum(['SIN_FACTURAR', 'POR_PAGAR', 'PAGADO', 'LIBRE', 'TODOS']).default('SIN_FACTURAR'),
  clienteId: z.string().uuid().optional(), q: z.string().trim().max(40).optional(),
  desde: z.coerce.date().optional(), hasta: z.coerce.date().optional(),
  pagina: z.coerce.number().optional(), porPagina: z.coerce.number().optional(),
});
const Enlazar = z.object({ factura: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{1,10}-\d{1,4}-\d{1,12}$/, 'Escriba el número como sale en Siigo, por ejemplo FV-2-1234.') });
const Libre = z.object({ motivo: z.string().trim().min(5, 'Escriba el motivo (mínimo 5 caracteres).').max(300) });
const Regla = z.object({ regla: z.nativeEnum(ReglaCertificado), motivo: z.string().trim().max(300).optional() });
/** La alerta cuenta los manifiestos realizados hace más de estos días y aún sin factura. */
export const DIAS_PARA_FACTURAR = 5;
/** Lo que muestra el panel de cada manifiesto. */
const FILA = {
  id: true, numero: true, tipo: true, fechaServicio: true,
  cliente: { select: { id: true, razonSocial: true, nit: true, reglaCertificado: true, tipoNegociacion: true } },
  finanzas: { include: { librePor: { select: { nombre: true } } } },
  facturas: { select: { origen: true, factura: { select: { id: true, nombre: true, fecha: true, vence: true, total: true, saldo: true, estado: true, estadoDian: true, urlPublica: true } } } },
} satisfies Prisma.ManifiestoSelect;
const dias = (m: { fechaServicio: Date }) => Math.max(0, Math.round((fechaColombia().getTime() - m.fechaServicio.getTime()) / 86_400_000));
const SIN_FACTURAR: Prisma.ManifiestoWhereInput = { OR: [{ finanzas: null }, { finanzas: { facturado: false, estadoPago: { not: 'LIBRE' } } }] };

@Injectable()
export class FinanzasService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger('Siigo');
  private readonly siigo: SiigoCliente;
  private reloj: NodeJS.Timeout | null = null;
  private empresaDeSiigo: Promise<string | null> | null = null;
  constructor(private readonly db: PrismaService, private readonly audit: Auditoria, private readonly cfg: ConfigService<Config, true>) {
    this.siigo = new SiigoCliente({ url: cfg.get('SIIGO_URL', { infer: true }), usuario: cfg.get('SIIGO_USERNAME', { infer: true }),
      clave: cfg.get('SIIGO_ACCESS_KEY', { infer: true }), partner: cfg.get('SIIGO_PARTNER_ID', { infer: true }) });
  }

  // ---------------- Sincronización ----------------
  /**
   * La empresa dueña de la cuenta de Siigo: la del NIT de SIIGO_EMPRESA_NIT o, si no se indica, la única de la instalación.
   * Con varias empresas y sin ese NIT, Siigo queda apagado: las facturas de una empresa nunca pasan a otra.
   */
  private empresaSiigo() {
    this.empresaDeSiigo ??= (async () => {
      if (!this.siigo.configurado) return null;
      const nit = this.cfg.get('SIIGO_EMPRESA_NIT', { infer: true }).replace(/\D/g, '');
      const empresas = await this.db.empresa.findMany({ select: { id: true, nit: true } });
      const base = (x: string) => x.split('-')[0].replace(/\D/g, '');
      const e = nit ? empresas.find((x) => base(x.nit) === base(this.cfg.get('SIIGO_EMPRESA_NIT', { infer: true }))) : empresas.length === 1 ? empresas[0] : undefined;
      if (!e) this.log.warn(nit ? `SIIGO_EMPRESA_NIT (${nit}) no corresponde a ninguna empresa: Siigo queda apagado.` : 'Hay varias empresas: indique SIIGO_EMPRESA_NIT para usar Siigo.');
      return e?.id ?? null;
    })().catch(() => { this.empresaDeSiigo = null; return null; });
    return this.empresaDeSiigo;
  }
  /** ¿Esta empresa usa la cuenta de Siigo configurada? */
  private async conSiigo(empresaId: string) { return (await this.empresaSiigo()) === empresaId; }

  onApplicationBootstrap() {
    if (!this.siigo.configurado || !this.cfg.get('SIIGO_SINCRONIZAR', { infer: true })) return;
    this.reloj = setInterval(() => void this.diaria(), 10 * 60_000);
    this.reloj.unref?.();
    setTimeout(() => void this.diaria(), 60_000).unref?.();
  }
  onModuleDestroy() { if (this.reloj) clearInterval(this.reloj); }

  /** La diaria: desde la hora configurada (Colombia), una vez al día por empresa (el índice único decide quién la hace). */
  private async diaria() {
    try {
      const hora = Number(new Date().toLocaleString('en-US', { timeZone: 'America/Bogota', hour: 'numeric', hour12: false })) % 24;
      if (hora < this.cfg.get('SIIGO_HORA', { infer: true })) return;
      const dia = fechaColombia().toISOString().slice(0, 10);
      const empresaId = await this.empresaSiigo();
      if (!empresaId) return;
      const [x] = await this.db.$queryRaw<{ id: string }[]>`
        INSERT INTO sincronizaciones_siigo (empresa_id, origen, dia) VALUES (${empresaId}::uuid, 'AUTOMATICA', ${dia}::date) ON CONFLICT DO NOTHING RETURNING id`;
      if (x) await this.ejecutar(empresaId, x.id);
    } catch (e) { this.log.error(`Sincronización diaria: ${(e as Error).message}`); }
  }

  /** Botón «Sincronizar con Siigo»: responde de inmediato y el panel muestra cuándo termina. */
  async sincronizarAhora(a: Actor) {
    if (!(await this.conSiigo(a.empresaId))) throw new BadRequestException({ mensaje: 'Siigo no está configurado para su empresa en el servidor (usuario, clave de acceso, Partner-Id y NIT de la empresa).' });
    const enCurso = await this.db.sincronizacionSiigo.findFirst({ where: { empresaId: a.empresaId, estado: 'EN_CURSO', iniciadaEn: { gte: new Date(Date.now() - 20 * 60_000) } } });
    if (enCurso) return enCurso;
    const s = await this.db.sincronizacionSiigo.create({ data: { empresaId: a.empresaId, origen: 'MANUAL', dia: fechaColombia(), usuarioId: a.id } });
    await this.audit.registrar(a, 'siigo', s.id, 'SINCRONIZAR');
    setImmediate(() => void this.ejecutar(a.empresaId, s.id));
    return s;
  }

  private async ejecutar(empresaId: string, id: string) {
    const t0 = Date.now();
    try {
      const facturas = await this.siigo.todas<FacturaApi>('invoices');
      const notas = await this.siigo.todas<NotaCreditoApi>('credit-notes');
      const r = await this.aplicar(empresaId, facturas, notas);
      await this.db.sincronizacionSiigo.update({ where: { id }, data: { estado: 'LISTA', terminadaEn: new Date(), facturas: facturas.length, enlazadas: r.enlazadas, avisos: r.avisos.slice(0, 100) } });
      this.log.log(`Sincronización lista: ${facturas.length} facturas, ${notas.length} notas crédito, ${r.enlazadas} manifiestos con factura (${Date.now() - t0} ms)`);
    } catch (e) {
      const mensaje = e instanceof ErrorSiigo ? e.message : 'No se pudo completar la sincronización con Siigo.';
      if (!(e instanceof ErrorSiigo)) this.log.error(`Sincronización ${id}: ${(e as Error).stack ?? e}`);
      await this.db.sincronizacionSiigo.update({ where: { id }, data: { estado: 'FALLIDA', terminadaEn: new Date(), error: mensaje.slice(0, 500) } }).catch(() => undefined);
    }
  }

  /** Guarda las facturas, las cruza con los manifiestos, pasa sus datos a las conciliaciones y recalcula el estado. */
  private async aplicar(empresaId: string, facturas: FacturaApi[], notas: NotaCreditoApi[]) {
    const avisos: string[] = [];
    const creditos = new Map<string, number>();
    for (const n of notas) if (n.invoice?.id) creditos.set(n.invoice.id, (creditos.get(n.invoice.id) ?? 0) + (Number(n.total) || 0));
    const clientes = await this.db.cliente.findMany({ where: { empresaId }, select: { id: true, nit: true } });
    const clientePorNit = new Map(clientes.map((c) => [c.nit.replace(/\D/g, ''), c.id]));
    const filas = facturas.filter((f) => f?.id && f.name && f.date).map((f) => {
      const total = Number(f.total) || 0, saldo = Number(f.balance) || 0, nc = creditos.get(f.id) ?? 0;
      const nit = String(f.customer?.identification ?? '').replace(/\D/g, '');
      return {
        siigo_id: String(f.id).slice(0, 60), nombre: String(f.name).toUpperCase().slice(0, 30), fecha: String(f.date).slice(0, 10), vence: venceFactura(f), total, saldo, nc,
        estado: estadoFactura({ total, balance: saldo }, nc), dian: f.stamp?.status?.slice(0, 30) ?? null, nit: nit.slice(0, 20), cliente: clientePorNit.get(nit) ?? null,
        citados: manifiestosCitados(`${f.observations ?? ''} ${(f.items ?? []).map((i) => i.description ?? '').join(' ')}`), url: f.public_url ?? null,
      };
    });
    // 1. Copia local (en lotes)
    for (let i = 0; i < filas.length; i += 400) {
      await this.db.$executeRaw`
        INSERT INTO facturas_siigo (empresa_id, siigo_id, nombre, fecha, vence, total, saldo, notas_credito, estado, estado_dian, cliente_nit, cliente_id, manifiestos_citados, url_publica, sincronizada_en)
        SELECT ${empresaId}::uuid, x.siigo_id, x.nombre, x.fecha::date, x.vence::date, x.total, x.saldo, x.nc, x.estado::"EstadoFacturaSiigo", x.dian, x.nit, x.cliente::uuid,
               COALESCE(x.citados, '{}'), x.url, now()
          FROM jsonb_to_recordset(${JSON.stringify(filas.slice(i, i + 400))}::jsonb)
            AS x(siigo_id text, nombre text, fecha text, vence text, total numeric, saldo numeric, nc numeric, estado text, dian text, nit text, cliente text, citados text[], url text)
        ON CONFLICT (empresa_id, siigo_id) DO UPDATE SET nombre = EXCLUDED.nombre, fecha = EXCLUDED.fecha, vence = EXCLUDED.vence, total = EXCLUDED.total,
          saldo = EXCLUDED.saldo, notas_credito = EXCLUDED.notas_credito, estado = EXCLUDED.estado, estado_dian = EXCLUDED.estado_dian, cliente_nit = EXCLUDED.cliente_nit,
          cliente_id = EXCLUDED.cliente_id, manifiestos_citados = EXCLUDED.manifiestos_citados, url_publica = EXCLUDED.url_publica, sincronizada_en = now()`;
    }
    // 2. Qué factura cubre qué manifiesto
    const guardadas = await this.db.facturaSiigo.findMany({ where: { empresaId }, select: { id: true, nombre: true, clienteNit: true, manifiestosCitados: true } });
    const manifiestos = await this.db.manifiesto.findMany({ where: { empresaId, estado: { not: 'ANULADO' } }, select: { id: true, numero: true, cliente: { select: { nit: true } } } });
    const porNumero = new Map<string, { id: string; numero: string; nit: string }[]>();
    for (const m of manifiestos) {
      const n = Number(m.numero.replace(/^\D+/, ''));
      if (!Number.isFinite(n) || !m.numero) continue;
      porNumero.set(String(n), [...(porNumero.get(String(n)) ?? []), { id: m.id, numero: m.numero, nit: m.cliente.nit.replace(/\D/g, '') }]);
    }
    const conNumero = await this.db.conciliacionItem.findMany({ where: { facturaNumero: { not: null }, conciliacion: { empresaId, estado: { not: 'ANULADA' } } },
      select: { facturaNumero: true, conciliacion: { select: { manifiestoId: true } } } });
    const porFactura = new Map<string, Set<string>>();
    for (const x of conNumero) { const k = x.facturaNumero!.trim().toUpperCase(); porFactura.set(k, (porFactura.get(k) ?? new Set()).add(x.conciliacion.manifiestoId)); }
    const deseados = new Map<string, Map<string, 'CITADO' | 'NUMERO'>>();
    for (const f of guardadas) {
      const m = new Map<string, 'CITADO' | 'NUMERO'>();
      for (const n of f.manifiestosCitados) for (const x of porNumero.get(n) ?? []) {
        if (x.nit === f.clienteNit) m.set(x.id, 'CITADO');
        else avisos.push(`La factura ${f.nombre} cita el manifiesto ${x.numero}, que es de otro cliente: no se enlazó.`);
      }
      for (const id of porFactura.get(f.nombre) ?? []) if (!m.has(id)) m.set(id, 'NUMERO');
      if (m.size) deseados.set(f.id, m);
    }
    const actuales = await this.db.facturaManifiesto.findMany({ where: { factura: { empresaId } }, select: { facturaId: true, manifiestoId: true, origen: true } });
    const ya = new Set(actuales.map((x) => `${x.facturaId}|${x.manifiestoId}`));
    const quitar = actuales.filter((x) => x.origen !== 'MANUAL' && !deseados.get(x.facturaId)?.has(x.manifiestoId));
    const poner = [...deseados].flatMap(([facturaId, ms]) => [...ms].filter(([manifiestoId]) => !ya.has(`${facturaId}|${manifiestoId}`)).map(([manifiestoId, origen]) => ({ facturaId, manifiestoId, origen })));
    for (let i = 0; i < quitar.length; i += 200) {
      await this.db.facturaManifiesto.deleteMany({ where: { OR: quitar.slice(i, i + 200).map((x) => ({ facturaId: x.facturaId, manifiestoId: x.manifiestoId })) } });
    }
    if (poner.length) await this.db.facturaManifiesto.createMany({ data: poner, skipDuplicates: true });
    // 3. Número, vencimiento y estado de pago en las líneas de la conciliación (la base permite cambiarlos aunque esté aprobada)
    await this.db.$executeRaw`
      UPDATE conciliacion_items ci SET factura_emision = f.fecha, factura_vencimiento = f.vence, estado_pago = f.estado::text::"EstadoPago"
        FROM facturas_siigo f, conciliaciones c
       WHERE c.id = ci.conciliacion_id AND c.empresa_id = ${empresaId}::uuid AND c.estado <> 'ANULADA'
         AND f.empresa_id = ${empresaId}::uuid AND upper(trim(ci.factura_numero)) = f.nombre
         AND (ci.factura_emision, ci.factura_vencimiento, ci.estado_pago::text) IS DISTINCT FROM (f.fecha, f.vence, f.estado::text)`;
    await this.db.$executeRaw`
      UPDATE conciliacion_items ci SET factura_numero = u.nombre, factura_emision = u.fecha, factura_vencimiento = u.vence, estado_pago = u.estado::"EstadoPago"
        FROM (SELECT fm.manifiesto_id, min(f.nombre) AS nombre, min(f.fecha) AS fecha, min(f.vence) AS vence, min(f.estado::text) AS estado
                FROM factura_manifiestos fm JOIN facturas_siigo f ON f.id = fm.factura_id
               WHERE f.empresa_id = ${empresaId}::uuid AND f.estado <> 'ANULADA'
               GROUP BY fm.manifiesto_id HAVING count(*) = 1) u, conciliaciones c
       WHERE c.id = ci.conciliacion_id AND c.manifiesto_id = u.manifiesto_id AND c.estado <> 'ANULADA' AND ci.factura_numero IS NULL`;
    // 4. Estado financiero de cada manifiesto realizado
    await recalcularFinanzas(this.db, empresaId);
    const enlazadas = new Set([...deseados.values()].flatMap((m) => [...m.keys()])).size;
    return { enlazadas, avisos: [...new Set(avisos)] };
  }

  // ---------------- Consultas ----------------
  async estadoSiigo(a: Actor) {
    const [ultima, ultimaLista] = await Promise.all([
      this.db.sincronizacionSiigo.findFirst({ where: { empresaId: a.empresaId }, orderBy: { iniciadaEn: 'desc' }, include: { usuario: { select: { nombre: true } } } }),
      this.db.sincronizacionSiigo.findFirst({ where: { empresaId: a.empresaId, estado: 'LISTA' }, orderBy: { iniciadaEn: 'desc' }, select: { terminadaEn: true, facturas: true, enlazadas: true } }),
    ]);
    const configurado = await this.conSiigo(a.empresaId);
    return { configurado, diaria: configurado && this.cfg.get('SIIGO_SINCRONIZAR', { infer: true }), hora: this.cfg.get('SIIGO_HORA', { infer: true }),
      ultima: ultima ? { ...ultima, usuario: ultima.usuario?.nombre ?? null } : null, ultimaLista };
  }

  async resumen(a: Actor) {
    const base = { empresaId: a.empresaId, estado: 'REALIZADO' as const };
    const antes = new Date(fechaColombia().getTime() - DIAS_PARA_FACTURAR * 86_400_000);
    const [sinFacturar, atrasados, porPagar, pagados, libres, saldo] = await Promise.all([
      this.db.manifiesto.count({ where: { ...base, ...SIN_FACTURAR } }),
      this.db.manifiesto.count({ where: { ...base, ...SIN_FACTURAR, fechaServicio: { lt: antes } } }),
      this.db.manifiesto.count({ where: { ...base, finanzas: { facturado: true, estadoPago: 'PENDIENTE' } } }),
      this.db.manifiesto.count({ where: { ...base, finanzas: { estadoPago: 'PAGADO' } } }),
      this.db.manifiesto.count({ where: { ...base, finanzas: { estadoPago: 'LIBRE' } } }),
      this.db.facturaSiigo.aggregate({ where: { empresaId: a.empresaId, estado: { in: ['PENDIENTE', 'ABONADA'] }, manifiestos: { some: {} } }, _sum: { saldo: true }, _count: true }),
    ]);
    return { sinFacturar, sinFacturarAtrasados: atrasados, diasParaFacturar: DIAS_PARA_FACTURAR, porPagar, pagados, libres,
      saldoPendiente: saldo._sum.saldo?.toString() ?? '0', facturasPendientes: saldo._count, siigo: await this.estadoSiigo(a) };
  }

  async manifiestos(a: Actor, f: z.infer<typeof Filtros>) {
    const { take, skip, pagina, porPagina } = paginar(f);
    const porEstado: Prisma.ManifiestoWhereInput = f.estado === 'SIN_FACTURAR' ? SIN_FACTURAR
      : f.estado === 'POR_PAGAR' ? { finanzas: { facturado: true, estadoPago: 'PENDIENTE' } }
      : f.estado === 'PAGADO' ? { finanzas: { estadoPago: 'PAGADO' } } : f.estado === 'LIBRE' ? { finanzas: { estadoPago: 'LIBRE' } } : {};
    const where: Prisma.ManifiestoWhereInput = {
      empresaId: a.empresaId, estado: 'REALIZADO', clienteId: f.clienteId, ...porEstado,
      ...(f.desde || f.hasta ? { fechaServicio: { gte: f.desde, lte: f.hasta } } : {}),
      ...(f.q ? { OR: [{ numero: { contains: f.q, mode: 'insensitive' } }, { cliente: { razonSocial: { contains: f.q, mode: 'insensitive' } } }] } : {}),
    };
    const [total, filas] = await this.db.$transaction([
      this.db.manifiesto.count({ where }),
      this.db.manifiesto.findMany({ where, take, skip, orderBy: [{ fechaServicio: 'asc' }, { numero: 'asc' }], select: FILA }),
    ]);
    return { total, pagina, porPagina, filas: filas.map((m) => ({ ...m, dias: dias(m) })) };
  }

  /** Lo financiero de un cliente para su ficha: su regla y cuántos manifiestos tiene sin facturar o por pagar. */
  async cliente(a: Actor, id: string) {
    const c = await this.db.cliente.findFirst({ where: { id, empresaId: a.empresaId }, select: { id: true, reglaCertificado: true } });
    if (!c) throw new NotFoundException({ mensaje: 'Cliente no encontrado.' });
    const base = { empresaId: a.empresaId, clienteId: id, estado: 'REALIZADO' as const };
    const [sinFacturar, porPagar] = await Promise.all([
      this.db.manifiesto.count({ where: { ...base, ...SIN_FACTURAR } }),
      this.db.manifiesto.count({ where: { ...base, finanzas: { facturado: true, estadoPago: 'PENDIENTE' } } }),
    ]);
    return { ...c, sinFacturar, porPagar };
  }

  // ---------------- Acciones de facturación ----------------
  private async manifiestoPropio(a: Actor, id: string) {
    const m = await this.db.manifiesto.findFirst({ where: { id, empresaId: a.empresaId }, include: { cliente: { select: { nit: true, razonSocial: true } } } });
    if (!m) throw new NotFoundException({ mensaje: 'Manifiesto no encontrado.' });
    if (m.estado !== 'REALIZADO') throw new BadRequestException({ mensaje: `El manifiesto ${m.numero} aún no está realizado.` });
    return m;
  }

  /** Enlaza a mano una factura de Siigo (FV-2-1234) con un manifiesto que la factura no cita. Debe ser del mismo cliente. */
  async enlazar(a: Actor, id: string, b: z.infer<typeof Enlazar>) {
    const m = await this.manifiestoPropio(a, id);
    let f = await this.db.facturaSiigo.findFirst({ where: { empresaId: a.empresaId, nombre: b.factura } });
    if (!f) {
      if (!(await this.conSiigo(a.empresaId))) throw new BadRequestException({ mensaje: `La factura ${b.factura} no está en la copia local y Siigo no está configurado para su empresa.` });
      const api = await this.siigo.facturaPorNombre(b.factura).catch((e) => { throw new BadRequestException({ mensaje: e instanceof ErrorSiigo ? e.message : 'No se pudo consultar Siigo.' }); });
      if (!api) throw new NotFoundException({ mensaje: `Siigo no tiene la factura ${b.factura}.` });
      await this.aplicarUna(a.empresaId, api);
      f = await this.db.facturaSiigo.findFirstOrThrow({ where: { empresaId: a.empresaId, nombre: b.factura } });
    }
    if (f.clienteNit !== m.cliente.nit.replace(/\D/g, '')) throw new BadRequestException({ mensaje: `La factura ${f.nombre} es de otro cliente (NIT ${f.clienteNit}), no de ${m.cliente.razonSocial}.` });
    if (f.estado === 'ANULADA') throw new BadRequestException({ mensaje: `La factura ${f.nombre} está anulada con notas crédito.` });
    await this.db.facturaManifiesto.upsert({ where: { facturaId_manifiestoId: { facturaId: f.id, manifiestoId: id } }, update: {}, create: { facturaId: f.id, manifiestoId: id, origen: 'MANUAL', creadoPorId: a.id } });
    await recalcularFinanzas(this.db, a.empresaId, [id]);
    await this.audit.registrar(a, 'manifiesto', id, 'ENLAZAR_FACTURA', undefined, { factura: f.nombre });
    return this.fila(a, id);
  }

  /** Una factura suelta (consultada por su número) a la copia local, sin la nota crédito: la diaria la completa. */
  private async aplicarUna(empresaId: string, f: FacturaApi) {
    const total = Number(f.total) || 0, saldo = Number(f.balance) || 0, nit = String(f.customer?.identification ?? '').replace(/\D/g, '');
    const cliente = (await this.db.cliente.findFirst({ where: { empresaId, nit }, select: { id: true } }))?.id ?? null;
    const datos = { nombre: f.name.toUpperCase().slice(0, 30), fecha: new Date(`${f.date.slice(0, 10)}T00:00:00Z`), vence: venceFactura(f) ? new Date(`${venceFactura(f)}T00:00:00Z`) : null,
      total, saldo, estado: estadoFactura({ total, balance: saldo }, 0), estadoDian: f.stamp?.status?.slice(0, 30) ?? null, clienteNit: nit.slice(0, 20), clienteId: cliente,
      manifiestosCitados: manifiestosCitados(`${f.observations ?? ''} ${(f.items ?? []).map((i) => i.description ?? '').join(' ')}`), urlPublica: f.public_url ?? null, sincronizadaEn: new Date() };
    await this.db.facturaSiigo.upsert({ where: { empresaId_siigoId: { empresaId, siigoId: f.id } }, update: datos, create: { empresaId, siigoId: f.id, ...datos } });
  }

  /** Quita un enlace hecho a mano (los automáticos salen del texto de la factura: se corrigen en Siigo). */
  async desenlazar(a: Actor, id: string, facturaId: string) {
    await this.manifiestoPropio(a, id);
    const x = await this.db.facturaManifiesto.findUnique({ where: { facturaId_manifiestoId: { facturaId, manifiestoId: id } }, include: { factura: { select: { nombre: true, empresaId: true } } } });
    if (!x || x.factura.empresaId !== a.empresaId) throw new NotFoundException({ mensaje: 'Ese enlace no existe.' });
    if (x.origen !== 'MANUAL') throw new BadRequestException({ mensaje: `La factura ${x.factura.nombre} cita este manifiesto (o su número está en la conciliación): corríjalo allí y vuelva a sincronizar.` });
    await this.db.facturaManifiesto.delete({ where: { facturaId_manifiestoId: { facturaId, manifiestoId: id } } });
    await recalcularFinanzas(this.db, a.empresaId, [id]);
    await this.audit.registrar(a, 'manifiesto', id, 'DESENLAZAR_FACTURA', { factura: x.factura.nombre });
    return this.fila(a, id);
  }

  /** Sin cobro (servicio gratuito, acuerdo especial, cortesía): ya no cuenta como pendiente y no retiene el certificado. */
  async marcarLibre(a: Actor, id: string, b: z.infer<typeof Libre>) {
    await this.manifiestoPropio(a, id);
    const datos = { libreMotivo: b.motivo, librePorId: a.id, libreEn: new Date() };
    await this.db.manifiestoFinanzas.upsert({ where: { manifiestoId: id }, update: datos, create: { manifiestoId: id, empresaId: a.empresaId, ...datos } });
    await recalcularFinanzas(this.db, a.empresaId, [id]);
    await this.audit.registrar(a, 'manifiesto', id, 'LIBRE', undefined, { motivo: b.motivo });
    return this.fila(a, id);
  }

  async quitarLibre(a: Actor, id: string) {
    await this.manifiestoPropio(a, id);
    const antes = await this.db.manifiestoFinanzas.findUnique({ where: { manifiestoId: id } });
    if (!antes?.libreEn) throw new BadRequestException({ mensaje: 'El manifiesto no está marcado sin cobro.' });
    await this.db.manifiestoFinanzas.update({ where: { manifiestoId: id }, data: { libreMotivo: null, librePorId: null, libreEn: null } });
    await recalcularFinanzas(this.db, a.empresaId, [id]);
    await this.audit.registrar(a, 'manifiesto', id, 'QUITAR_LIBRE', { motivo: antes.libreMotivo });
    return this.fila(a, id);
  }

  /**
   * Regla del certificado del cliente. La de Terra Viva es «Exigir factura» (gerencia, 20-11-2026); una más flexible es una
   * excepción que solo dan Facturación o Gerencia (finanzas.gestionar), siempre con su motivo.
   */
  async regla(a: Actor, id: string, b: z.infer<typeof Regla>) {
    const c = await this.db.cliente.findFirst({ where: { id, empresaId: a.empresaId }, select: { id: true, reglaCertificado: true } });
    if (!c) throw new NotFoundException({ mensaje: 'Cliente no encontrado.' });
    if (c.reglaCertificado === b.regla) return c;
    if (esExcepcionCertificado(b.regla) && (b.motivo ?? '').length < 10)
      throw new BadRequestException({ mensaje: 'Una excepción a «Exigir factura» necesita su motivo (mínimo 10 caracteres): queda en la auditoría.' });
    const r = await this.db.cliente.update({ where: { id }, data: { reglaCertificado: b.regla }, select: { id: true, reglaCertificado: true } });
    await this.audit.registrar(a, 'cliente', id, 'REGLA_CERTIFICADO', { regla: c.reglaCertificado }, { regla: b.regla, ...(b.motivo ? { motivo: b.motivo } : {}) });
    return r;
  }

  private async fila(a: Actor, id: string) {
    const m = await this.db.manifiesto.findFirstOrThrow({ where: { id, empresaId: a.empresaId }, select: FILA });
    return { ...m, dias: dias(m) };
  }
}

@Controller('finanzas')
class FinanzasController {
  constructor(private readonly s: FinanzasService) {}
  @Permiso('finanzas.ver') @Get('resumen') resumen(@ActorActual() a: Actor) { return this.s.resumen(a); }
  @Permiso('finanzas.ver') @Get('siigo') siigo(@ActorActual() a: Actor) { return this.s.estadoSiigo(a); }
  @Permiso('finanzas.ver') @Get('manifiestos') manifiestos(@ActorActual() a: Actor, @Query(new Zod(Filtros)) f: z.infer<typeof Filtros>) { return this.s.manifiestos(a, f); }
  @Permiso('finanzas.ver') @Get('clientes/:id') cliente(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string) { return this.s.cliente(a, id); }
  @Permiso('finanzas.gestionar') @Patch('clientes/:id/regla-certificado') regla(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body(new Zod(Regla)) b: z.infer<typeof Regla>) { return this.s.regla(a, id, b); }
  @Permiso('finanzas.gestionar') @Post('siigo/sincronizar') @HttpCode(202) sincronizar(@ActorActual() a: Actor) { return this.s.sincronizarAhora(a); }
  @Permiso('finanzas.gestionar') @Post('manifiestos/:id/facturas') enlazar(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body(new Zod(Enlazar)) b: z.infer<typeof Enlazar>) { return this.s.enlazar(a, id, b); }
  @Permiso('finanzas.gestionar') @Delete('manifiestos/:id/facturas/:facturaId')
  desenlazar(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Param('facturaId', ParseUUIDPipe) facturaId: string) { return this.s.desenlazar(a, id, facturaId); }
  @Permiso('finanzas.gestionar') @Post('manifiestos/:id/libre') libre(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body(new Zod(Libre)) b: z.infer<typeof Libre>) { return this.s.marcarLibre(a, id, b); }
  @Permiso('finanzas.gestionar') @Delete('manifiestos/:id/libre') quitarLibre(@ActorActual() a: Actor, @Param('id', ParseUUIDPipe) id: string) { return this.s.quitarLibre(a, id); }
}

@Module({ controllers: [FinanzasController], providers: [FinanzasService], exports: [FinanzasService] })
export class FinanzasModule {}
