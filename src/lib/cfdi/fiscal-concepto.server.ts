// Datos fiscales de los procedimientos del catálogo (ws1-t4, vuelta 2: F-11 y F-08).
//
// Columnas `procedure_catalog."claveSat"` y `procedure_catalog."ivaCfdi"`, por SQL
// a mano (sql/ws1-t4-cfdi-conceptos.sql) y por SQL CRUDO, NUNCA en
// prisma/schema.prisma: `procedure_catalog` la lee casi toda la app sin
// `select` y declararlas tumbaría esas lecturas (P2022) mientras el SQL no esté
// pegado — el mismo motivo que `orthoIncludedInTreatment`
// (lib/orthodontics/catalog-procedures.ts). Sin el SQL: nada se guarda, cada
// concepto toma la clave por defecto de su categoría y el IVA de la factura.

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { aceptacionEncendida } from "@/lib/quotes/aceptacion-db";
import { itemLineTotal } from "@/lib/invoice-totals";
import {
  esClaveSat, esIvaConcepto, normalizarNombre, resolverConcepto,
  type ConceptoResuelto, type IvaConcepto, type ProcedimientoFiscal,
} from "./fiscal-concepto";

type Db = Prisma.TransactionClient | typeof prisma;

export const SQL_CONCEPTOS = "sql/ws1-t4-cfdi-conceptos.sql";

const CLAVE = Symbol.for("dalecontrol.cfdi-conceptos.columnas");
const TTL_AUSENTE_MS = 10 * 60_000;

function cache(): { v: { hay: boolean; at: number } | null } {
  const g = globalThis as any;
  if (!g[CLAVE]) g[CLAVE] = { v: null };
  return g[CLAVE];
}

/** Solo para pruebas. */
export function _olvidarColumnasFiscales(): void {
  cache().v = null;
}

export async function columnasFiscalesProcedimientos(db: Db = prisma): Promise<boolean> {
  const c = cache();
  const t = Date.now();
  if (c.v && (c.v.hay || t - c.v.at < TTL_AUSENTE_MS)) return c.v.hay;
  try {
    const filas = await db.$queryRaw<{ column_name: string }[]>`
      SELECT column_name FROM information_schema.columns
       WHERE table_schema = current_schema() AND table_name = 'procedure_catalog'
         AND column_name IN ('claveSat', 'ivaCfdi')`;
    c.v = { hay: filas.length === 2, at: t };
  } catch (e) {
    console.warn("[cfdi:conceptos] no se pudieron leer las columnas de procedure_catalog:", e);
    c.v = { hay: false, at: t };
  }
  return c.v.hay;
}

export interface FiscalDeProcedimiento {
  claveSat: string | null;
  ivaCfdi: IvaConcepto | null;
}

/** Clave e IVA guardados de cada procedimiento de la clínica (id → datos). Nunca lanza. */
export async function fiscalDeProcedimientos(db: Db, clinicId: string): Promise<Record<string, FiscalDeProcedimiento>> {
  const out: Record<string, FiscalDeProcedimiento> = {};
  try {
    if (!clinicId || !(await columnasFiscalesProcedimientos(db))) return out;
    const filas = await db.$queryRaw<{ id: string; claveSat: string | null; ivaCfdi: string | null }[]>`
      SELECT "id", "claveSat", "ivaCfdi" FROM "procedure_catalog" WHERE "clinicId" = ${clinicId}`;
    for (const f of filas) {
      out[f.id] = {
        claveSat: esClaveSat(f.claveSat) ? f.claveSat.trim() : null,
        ivaCfdi: esIvaConcepto(f.ivaCfdi) ? f.ivaCfdi : null,
      };
    }
  } catch (e) {
    console.warn("[cfdi:conceptos] no se pudieron leer los datos fiscales:", e);
  }
  return out;
}

/** El catálogo de la clínica con lo que necesita el timbrado (activos e inactivos). */
export async function catalogoFiscal(db: Db, clinicId: string): Promise<ProcedimientoFiscal[]> {
  let procs: { id: string; name: string; category: string | null; isActive: boolean }[] = [];
  let fiscal: Record<string, FiscalDeProcedimiento> = {};
  try {
    [procs, fiscal] = await Promise.all([
      db.procedureCatalog.findMany({ where: { clinicId }, select: { id: true, name: true, category: true, isActive: true } }),
      fiscalDeProcedimientos(db, clinicId),
    ]);
  } catch (e) {
    // Sin catálogo legible cada concepto toma la clave por defecto de su nombre
    // y el IVA de la factura: el timbrado no se cae por esto.
    console.warn("[cfdi:conceptos] no se pudo leer el catálogo:", e);
  }
  return procs.map((p) => ({
    id: p.id,
    activo: p.isActive !== false,
    name: p.name,
    category: p.category,
    claveSat: fiscal[p.id]?.claveSat ?? null,
    ivaCfdi: fiscal[p.id]?.ivaCfdi ?? null,
  }));
}

/**
 * El procedimiento de cada renglón de una factura que salió de un PRESUPUESTO (C-40), para las
 * facturas que se crearon antes de que el renglón guardara su `procedureId`: el concepto del
 * presupuesto se llama igual que el renglón («Resina (36)» = nombre + diente). Por la factura
 * completa del presupuesto (`quotes."invoiceId"`) y por los cargos parciales
 * (`quote_charges`, si existe). Clave: la descripción normalizada. Nunca lanza.
 */
export async function procedimientosDeLaFactura(db: Db, clinicId: string, invoiceId: string): Promise<Map<string, string>> {
  return (await procedimientosDeFacturas(db, clinicId, [invoiceId])).get(invoiceId) ?? new Map();
}

/** Lo mismo para varias facturas de una vez (el reporte de la global, N-23): 2 consultas, no 2 por nota. */
export async function procedimientosDeFacturas(db: Db, clinicId: string, invoiceIds: readonly string[]): Promise<Map<string, Map<string, string>>> {
  const out = new Map<string, Map<string, string>>();
  const ids = Array.from(new Set(invoiceIds.filter(Boolean)));
  if (!clinicId || ids.length === 0) return out;
  const poner = (invoiceId: string, r: { name: string; toothFdi: string | null; procedureId: string | null }) => {
    if (!r.procedureId) return;
    const m = out.get(invoiceId) ?? new Map<string, string>();
    const k = normalizarNombre(r.toothFdi ? `${r.name} (${r.toothFdi})` : r.name);
    // El mismo concepto con dos procedimientos distintos: no se adivina.
    if (m.has(k) && m.get(k) !== r.procedureId) m.set(k, "");
    else m.set(k, r.procedureId);
    out.set(invoiceId, m);
  };
  try {
    const quotes = await db.quote.findMany({
      where: { clinicId, invoiceId: { in: ids } },
      select: { invoiceId: true, items: { select: { name: true, toothFdi: true, procedureId: true } } },
      take: 5000,
    });
    for (const q of quotes) for (const it of q.items) if (q.invoiceId) poner(q.invoiceId, it);
  } catch (e) {
    console.warn("[cfdi:conceptos] no se pudo leer el presupuesto de la factura:", e);
  }
  try {
    if (!(await aceptacionEncendida(db as any))) throw new Error("sin quote_charges");
    const filas = await db.$queryRaw<{ invoiceId: string; name: string; toothFdi: string | null; procedureId: string | null }[]>`
      SELECT c."invoiceId", qi."name", qi."toothFdi", qi."procedureId"
        FROM "quote_charges" c
        JOIN "quote_items" qi ON qi."id" = c."quoteItemId"
        JOIN "quotes" q ON q."id" = qi."quoteId" AND q."clinicId" = ${clinicId}
       WHERE c."clinicId" = ${clinicId} AND c."invoiceId" = ANY(${ids}::text[])`;
    for (const f of filas) poner(f.invoiceId, f);
  } catch {
    // Sin la tabla de cargos parciales (sql/presupuesto-aceptacion-parcial.sql): solo el presupuesto.
  }
  for (const m of Array.from(out.values())) for (const [k, v] of Array.from(m)) if (!v) m.delete(k);
  return out;
}

/**
 * N-23 (segunda auditoría de uso): qué parte de cada nota va gravada al 16% según sus conceptos,
 * con la MISMA resolución que el timbrado (procedimiento por id, por presupuesto o por nombre; si
 * no, el IVA de la nota). invoiceId → 0..1. Nunca lanza: sin datos, la nota no aparece en el mapa.
 */
export async function proporcionesIva16(
  db: Db,
  clinicId: string,
  facturas: readonly { id: string; items: unknown; ivaDeLaFactura: IvaConcepto }[],
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!clinicId || facturas.length === 0) return out;
  try {
    const [catalogo, delPresupuesto] = await Promise.all([
      catalogoFiscal(db, clinicId),
      procedimientosDeFacturas(db, clinicId, facturas.map((f) => f.id)),
    ]);
    for (const f of facturas) {
      const items = Array.isArray(f.items) ? (f.items as any[]) : [];
      const mapa = delPresupuesto.get(f.id);
      let total = 0;
      let gravado = 0;
      for (const it of items) {
        const t = Math.max(0, itemLineTotal(it));
        const r = resolverConcepto(it ?? {}, catalogo, f.ivaDeLaFactura, mapa?.get(normalizarNombre(it?.description)) ?? null);
        total += t;
        if (r.ivaModo === "iva16") gravado += t;
      }
      if (total > 0) out.set(f.id, gravado / total);
      else if (items.length === 0) continue;
      else out.set(f.id, f.ivaDeLaFactura === "iva16" ? 1 : 0);
    }
  } catch (e) {
    console.warn("[cfdi:conceptos] no se pudo calcular el IVA por concepto:", e);
  }
  return out;
}

/**
 * Lo que manda el formulario de Procedimientos. `undefined` = no se toca;
 * `null` o "" = se quita (vuelve al valor por defecto). Una clave que no sea de
 * 8 dígitos o un IVA desconocido es un error de captura.
 */
// Los dos campos en las dos formas: con "strict": false TypeScript no estrecha la unión por `ok`.
export function leerFiscalDeEntrada(body: any): { ok: true; datos: Partial<FiscalDeProcedimiento>; error?: undefined } | { ok: false; error: string; datos?: undefined } {
  const datos: Partial<FiscalDeProcedimiento> = {};
  if (body?.claveSat !== undefined) {
    const v = typeof body.claveSat === "string" ? body.claveSat.trim() : body.claveSat;
    if (v === null || v === "") datos.claveSat = null;
    else if (esClaveSat(v)) datos.claveSat = v;
    else return { ok: false, error: "La clave SAT del procedimiento son 8 dígitos (por ejemplo 85122001)." };
  }
  if (body?.ivaCfdi !== undefined) {
    const v = body.ivaCfdi;
    if (v === null || v === "") datos.ivaCfdi = null;
    else if (esIvaConcepto(v)) datos.ivaCfdi = v;
    else return { ok: false, error: "El IVA del procedimiento es «exento» o «iva16»." };
  }
  return { ok: true, datos };
}

/** Guarda clave e IVA de un procedimiento de la clínica. Sin el SQL no hace nada (y lo dice). */
export async function guardarFiscalDeProcedimiento(
  db: Db,
  args: { clinicId: string; procedureId: string; datos: Partial<FiscalDeProcedimiento> },
): Promise<boolean> {
  const { datos } = args;
  if (datos.claveSat === undefined && datos.ivaCfdi === undefined) return true;
  if (!(await columnasFiscalesProcedimientos(db))) return false;
  if (datos.claveSat !== undefined) {
    await db.$executeRaw`
      UPDATE "procedure_catalog" SET "claveSat" = ${datos.claveSat}
       WHERE "id" = ${args.procedureId} AND "clinicId" = ${args.clinicId}`;
  }
  if (datos.ivaCfdi !== undefined) {
    await db.$executeRaw`
      UPDATE "procedure_catalog" SET "ivaCfdi" = ${datos.ivaCfdi}
       WHERE "id" = ${args.procedureId} AND "clinicId" = ${args.clinicId}`;
  }
  return true;
}

/**
 * Clave e IVA de los renglones de una factura, como se van a timbrar (C-40): catálogo de la
 * clínica + el procedimiento de cada renglón (su id, el del presupuesto del que salió, o su
 * nombre). Lo usan las dos rutas de timbrado y la vista previa del formulario. Nunca lanza.
 */
export async function conceptosFiscalesDeFactura(
  db: Db,
  args: { clinicId: string; invoiceId: string; items: readonly any[]; ivaDeLaFactura: IvaConcepto },
): Promise<{ conceptos: ConceptoResuelto[]; catalogo: ProcedimientoFiscal[] }> {
  const [catalogo, delPresupuesto] = await Promise.all([
    catalogoFiscal(db, args.clinicId),
    procedimientosDeLaFactura(db, args.clinicId, args.invoiceId),
  ]);
  const conceptos = args.items.map((it) =>
    resolverConcepto(it ?? {}, catalogo, args.ivaDeLaFactura, delPresupuesto.get(normalizarNombre(it?.description)) ?? null));
  return { conceptos, catalogo };
}
