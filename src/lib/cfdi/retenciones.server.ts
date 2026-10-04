// Ajuste por clínica «Facturar a empresas con retención» (ws1-t4, vuelta 2: F-01).
//
// Columna clinics."cfdiRetenciones" BOOLEAN NOT NULL DEFAULT false, por SQL a
// mano (sql/ws1-t4-cfdi-retenciones.sql) y por SQL crudo (no está en Prisma: la
// tabla clinics la lee media app sin `select`). Sin el SQL: APAGADO, y sigue el
// candado de la Tanda 0 (no se timbra a una empresa desde 612/626).

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

type Db = Prisma.TransactionClient | typeof prisma;

export const SQL_RETENCIONES = "sql/ws1-t4-cfdi-retenciones.sql";

const CLAVE = Symbol.for("dalecontrol.cfdi-retenciones.columna");
const TTL_AUSENTE_MS = 10 * 60_000;

function cache(): { v: { hay: boolean; at: number } | null } {
  const g = globalThis as any;
  if (!g[CLAVE]) g[CLAVE] = { v: null };
  return g[CLAVE];
}

/** Solo para pruebas. */
export function _olvidarColumnaRetenciones(): void {
  cache().v = null;
}

export async function columnaRetenciones(db: Db = prisma): Promise<boolean> {
  const c = cache();
  const t = Date.now();
  if (c.v && (c.v.hay || t - c.v.at < TTL_AUSENTE_MS)) return c.v.hay;
  try {
    const filas = await db.$queryRaw<{ n: number }[]>`
      SELECT 1 AS n FROM information_schema.columns
       WHERE table_schema = current_schema() AND table_name = 'clinics' AND column_name = 'cfdiRetenciones'`;
    c.v = { hay: filas.length > 0, at: t };
  } catch (e) {
    console.warn("[cfdi:retenciones] no se pudo leer la columna:", e);
    c.v = { hay: false, at: t };
  }
  return c.v.hay;
}

/** ¿La clínica encendió las retenciones? Ante la duda, NO (lo conservador). Nunca lanza. */
export async function retencionesEncendidas(db: Db, clinicId: string): Promise<boolean> {
  try {
    if (!clinicId || !(await columnaRetenciones(db))) return false;
    const filas = await db.$queryRaw<{ v: boolean | null }[]>`
      SELECT "cfdiRetenciones" AS v FROM "clinics" WHERE "id" = ${clinicId}`;
    return filas[0]?.v === true;
  } catch (e) {
    console.warn("[cfdi:retenciones] no se pudo leer el ajuste:", e);
    return false;
  }
}

export async function guardarRetenciones(db: Db, clinicId: string, encendido: boolean): Promise<boolean> {
  if (!(await columnaRetenciones(db))) return false;
  await db.$executeRaw`UPDATE "clinics" SET "cfdiRetenciones" = ${encendido} WHERE "id" = ${clinicId}`;
  return true;
}
