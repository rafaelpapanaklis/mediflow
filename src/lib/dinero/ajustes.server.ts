// ═══════════════════════════════════════════════════════════════════
// Ajustes de dinero por clínica y cobros pasados a mano a una caja (ws1-t5).
//
// Dos tablas NUEVAS por SQL crudo (sql/ws1-t5-dinero-caja.sql, lo pega Rafael):
//   · clinic_dinero_ajustes  — «cierre automático a medianoche» (apagado de
//     fábrica) y el % máximo de descuento sin el dueño (20 de fábrica).
//   · caja_cobros_asignados  — cobro en efectivo fuera de corte que alguien
//     pasó a la caja abierta.
// Mientras no exista una tabla: se pregunta con to_regclass (no falla ni
// ensucia el log de Postgres), la respuesta vive 10 min en globalThis (sobrevive
// a las recargas de `next dev`) y se usan los valores de fábrica; asignar y
// guardar contestan «falta el SQL».
// ═══════════════════════════════════════════════════════════════════

import { prisma } from "@/lib/prisma";
import { DESCUENTO_MAX_PCT_POR_DEFECTO } from "./descuento-autorizacion";

type Db = Pick<typeof prisma, "$queryRaw" | "$executeRaw">;

export const TABLA_AJUSTES = "clinic_dinero_ajustes";
export const TABLA_ASIGNADOS = "caja_cobros_asignados";
const DIEZ_MIN = 10 * 60 * 1000;
const CLAVE = Symbol.for("dalecontrol.ws1-t5.tablas-dinero");

type Memoria = Map<string, { existe: boolean; at: number }>;
function memoria(): Memoria {
  const g = globalThis as unknown as Record<symbol, Memoria | undefined>;
  return (g[CLAVE] ??= new Map());
}

/** ¿Existe la tabla? Con memoria de 10 min (o se fuerza al usar justo esa función). */
export async function tablaExiste(nombre: string, db: Db = prisma, forzar = false): Promise<boolean> {
  const m = memoria();
  const r = m.get(nombre);
  if (!forzar && r && Date.now() - r.at < DIEZ_MIN) return r.existe;
  try {
    const filas = await db.$queryRaw<{ existe: boolean }[]>`SELECT to_regclass(${`public.${nombre}`}) IS NOT NULL AS existe`;
    const existe = filas[0]?.existe === true;
    m.set(nombre, { existe, at: Date.now() });
    return existe;
  } catch {
    return r?.existe ?? false;
  }
}

/** Solo pruebas: olvida lo que se sabía de las tablas. */
export function _olvidarTablas() {
  memoria().clear();
}

export interface AjustesDinero {
  cajaCierreAutomatico: boolean;
  descuentoMaxPct: number;
  /** false = falta el SQL: son los valores de fábrica y no se pueden guardar. */
  disponible: boolean;
}

export const AJUSTES_DE_FABRICA: Omit<AjustesDinero, "disponible"> = {
  cajaCierreAutomatico: false,
  descuentoMaxPct: DESCUENTO_MAX_PCT_POR_DEFECTO,
};

export async function leerAjustesDinero(clinicId: string, db: Db = prisma): Promise<AjustesDinero> {
  if (!clinicId || !(await tablaExiste(TABLA_AJUSTES, db))) return { ...AJUSTES_DE_FABRICA, disponible: false };
  try {
    const filas = await db.$queryRaw<{ cajaCierreAutomatico: boolean; descuentoMaxPct: unknown }[]>`
      SELECT "cajaCierreAutomatico", "descuentoMaxPct" FROM clinic_dinero_ajustes WHERE "clinicId" = ${clinicId}`;
    const f = filas[0];
    if (!f) return { ...AJUSTES_DE_FABRICA, disponible: true };
    const pct = Number(f.descuentoMaxPct);
    return {
      cajaCierreAutomatico: f.cajaCierreAutomatico === true,
      descuentoMaxPct: Number.isFinite(pct) ? pct : DESCUENTO_MAX_PCT_POR_DEFECTO,
      disponible: true,
    };
  } catch (e) {
    console.warn("[dinero:ajustes] no se pudieron leer:", (e as Error)?.message);
    return { ...AJUSTES_DE_FABRICA, disponible: true };
  }
}

/** Guarda los ajustes (upsert). `false` si falta el SQL. */
export async function guardarAjustesDinero(
  clinicId: string,
  userId: string,
  cambios: Partial<Omit<AjustesDinero, "disponible">>,
  db: Db = prisma,
): Promise<boolean> {
  if (!clinicId || !(await tablaExiste(TABLA_AJUSTES, db, true))) return false;
  const actual = await leerAjustesDinero(clinicId, db);
  const cierre = cambios.cajaCierreAutomatico ?? actual.cajaCierreAutomatico;
  const pct = cambios.descuentoMaxPct ?? actual.descuentoMaxPct;
  await db.$executeRaw`
    INSERT INTO clinic_dinero_ajustes ("clinicId", "cajaCierreAutomatico", "descuentoMaxPct", "updatedAt", "updatedById")
    VALUES (${clinicId}, ${cierre}, ${pct}, now(), ${userId})
    ON CONFLICT ("clinicId") DO UPDATE SET
      "cajaCierreAutomatico" = EXCLUDED."cajaCierreAutomatico",
      "descuentoMaxPct"      = EXCLUDED."descuentoMaxPct",
      "updatedAt"            = now(),
      "updatedById"          = EXCLUDED."updatedById"`;
  return true;
}

/** Clínicas con el cierre automático encendido (para el cron). Sin la tabla: ninguna. */
export async function clinicasConCierreAutomatico(db: Db = prisma): Promise<string[]> {
  if (!(await tablaExiste(TABLA_AJUSTES, db, true))) return [];
  const filas = await db.$queryRaw<{ clinicId: string }[]>`
    SELECT "clinicId" FROM clinic_dinero_ajustes WHERE "cajaCierreAutomatico" = true`;
  return filas.map((f) => f.clinicId);
}

/** Ids de cobros pasados a mano a cajas de la clínica (opcionalmente a UNA caja). */
export async function cobrosAsignados(
  clinicId: string,
  opts: { cashRegisterId?: string } = {},
  db: Db = prisma,
): Promise<Set<string>> {
  if (!clinicId || !(await tablaExiste(TABLA_ASIGNADOS, db))) return new Set();
  try {
    const filas = opts.cashRegisterId
      ? await db.$queryRaw<{ paymentId: string }[]>`
          SELECT "paymentId" FROM caja_cobros_asignados WHERE "clinicId" = ${clinicId} AND "cashRegisterId" = ${opts.cashRegisterId}`
      : await db.$queryRaw<{ paymentId: string }[]>`
          SELECT "paymentId" FROM caja_cobros_asignados WHERE "clinicId" = ${clinicId}`;
    return new Set(filas.map((f) => f.paymentId));
  } catch (e) {
    console.warn("[dinero:asignados] no se pudieron leer:", (e as Error)?.message);
    return new Set();
  }
}

/** Pasa un cobro a una caja. `false` si falta el SQL; idempotente (un cobro, una caja). */
export async function asignarCobroACaja(
  args: { clinicId: string; paymentId: string; cashRegisterId: string; userId: string },
  db: Db = prisma,
): Promise<boolean> {
  if (!args.clinicId || !(await tablaExiste(TABLA_ASIGNADOS, db, true))) return false;
  await db.$executeRaw`
    INSERT INTO caja_cobros_asignados ("paymentId", "clinicId", "cashRegisterId", "assignedById", "assignedAt")
    VALUES (${args.paymentId}, ${args.clinicId}, ${args.cashRegisterId}, ${args.userId}, now())
    ON CONFLICT ("paymentId") DO NOTHING`;
  return true;
}
