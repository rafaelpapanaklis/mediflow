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
import { esClaveSat, esIvaConcepto, type IvaConcepto, type ProcedimientoFiscal } from "./fiscal-concepto";

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
  let procs: { id: string; name: string; category: string | null }[] = [];
  let fiscal: Record<string, FiscalDeProcedimiento> = {};
  try {
    [procs, fiscal] = await Promise.all([
      db.procedureCatalog.findMany({ where: { clinicId }, select: { id: true, name: true, category: true } }),
      fiscalDeProcedimientos(db, clinicId),
    ]);
  } catch (e) {
    // Sin catálogo legible cada concepto toma la clave por defecto de su nombre
    // y el IVA de la factura: el timbrado no se cae por esto.
    console.warn("[cfdi:conceptos] no se pudo leer el catálogo:", e);
  }
  return procs.map((p) => ({
    name: p.name,
    category: p.category,
    claveSat: fiscal[p.id]?.claveSat ?? null,
    ivaCfdi: fiscal[p.id]?.ivaCfdi ?? null,
  }));
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
