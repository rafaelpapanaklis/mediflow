import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { LectorRaw } from "./tecnicas-de-la-clinica-db";
import {
  esPlanDetalleVacio,
  normalizarOpciones,
  normalizarPlanDetalle,
  opcionesEditadas,
  planDetalleVacio,
  type OpcionesDelPlan,
  type PlanDetalle,
} from "./plan-detalle";

// Ortodoncia — el «Plan de tratamiento» completo del caso y las listas de la clínica (ws1-t12). Dos columnas
// nuevas (sql/ortodoncia-plan-de-tratamiento.sql), NINGUNA declarada en schema.prisma a propósito: con una
// columna de menos, cualquier lectura del plan (decenas de sitios) o de la configuración tiraría P2022.
// Van por SQL crudo con su sonda, como billing-mode-db.ts y tecnicas-de-la-clinica-db.ts:
//   - orthodontic_treatment_plans."planDetalle" JSONB      → el plan completo del caso
//   - orthodontics_clinic_settings."planOptions" JSONB      → las listas editables de la clínica
// Sin la primera, el caso se ve como siempre y «Editar plan» dice que falta pegar el SQL; sin la segunda se
// ofrecen las listas de ejemplo (las de Dentalink) y Configuración avisa que no se pueden guardar.
//
// `clinicId` SIEMPRE el de la sesión, nunca del cliente: cada consulta lo filtra (un `undefined` no filtra
// nada en Prisma, así que sin clínica no se consulta).

const TTL_MS = 60_000;
type Sonda = { existe: boolean; at: number } | null;
let sondaPlan: Sonda = null;
let sondaOpciones: Sonda = null;

async function sondar(tabla: string, columna: string, db?: LectorRaw): Promise<boolean | null> {
  try {
    const filas = (await (db ?? prisma).$queryRaw(Prisma.sql`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_name = ${tabla} AND column_name = ${columna}
      ) AS existe`)) as { existe: boolean }[];
    return filas[0]?.existe === true;
  } catch (e) {
    console.warn(`[ortodoncia:plan] no se pudo comprobar ${tabla}.${columna}:`, e);
    return null;
  }
}

/** `db` = el cliente inyectado (Sabina, solo lectura): con él se comprueba la columna sin la caché global. */
export async function columnaDePlanDetalleExiste(db?: LectorRaw): Promise<boolean> {
  if (db) return (await sondar("orthodontic_treatment_plans", "planDetalle", db)) === true;
  const t = Date.now();
  if (sondaPlan && (sondaPlan.existe || t - sondaPlan.at < TTL_MS)) return sondaPlan.existe;
  const r = await sondar("orthodontic_treatment_plans", "planDetalle");
  if (r === null) return false;
  sondaPlan = { existe: r, at: t };
  return r;
}

export async function columnaDeOpcionesExiste(): Promise<boolean> {
  const t = Date.now();
  if (sondaOpciones && (sondaOpciones.existe || t - sondaOpciones.at < TTL_MS)) return sondaOpciones.existe;
  const r = await sondar("orthodontics_clinic_settings", "planOptions");
  if (r === null) return false;
  sondaOpciones = { existe: r, at: t };
  return r;
}

/** Solo para pruebas. */
export function _olvidarSondasDelPlan(): void {
  sondaPlan = null;
  sondaOpciones = null;
}

/** Un cliente que además sabe leer el seguimiento de alineadores (el `prisma` del repo, o el doble de Sabina). */
export interface LectorDelPlan extends LectorRaw {
  orthodonticAligner?: { findMany(args: unknown): Promise<Array<{ treatmentPlanId: string; totalTrays: number }>> };
}

/**
 * Los planes de estos casos, en lote. Un caso sin plan completo (o sin la columna) no sale en el mapa.
 * `alineadoresTotales` YA viene fusionado con el seguimiento de alineadores: si el caso lo tiene, manda
 * `orthodontic_aligners.totalTrays` (un solo dato; ver plan-detalle-guardar.ts). Nunca lanza.
 */
export async function cargarPlanesDetalle(clinicId: string, planIds: string[], db?: LectorDelPlan): Promise<Map<string, PlanDetalle>> {
  const salida = new Map<string, PlanDetalle>();
  const ids = [...new Set(planIds.filter(Boolean))];
  if (!clinicId || ids.length === 0) return salida;
  const cliente = (db ?? prisma) as LectorDelPlan;
  try {
    if (!(await columnaDePlanDetalleExiste(db))) return salida;
    const filas = (await cliente.$queryRaw(Prisma.sql`
      SELECT "id", "planDetalle" FROM "orthodontic_treatment_plans"
       WHERE "clinicId" = ${clinicId} AND "id" IN (${Prisma.join(ids)}) AND "planDetalle" IS NOT NULL`)) as { id: string; planDetalle: unknown }[];
    for (const f of filas) salida.set(f.id, normalizarPlanDetalle(f.planDetalle));
  } catch (e) {
    console.warn("[ortodoncia:plan] no se pudieron leer los planes:", e);
    return salida;
  }
  // El total de alineadores: del seguimiento, si existe.
  try {
    const aligner = cliente.orthodonticAligner ?? (db ? undefined : (prisma.orthodonticAligner as unknown as LectorDelPlan["orthodonticAligner"]));
    if (aligner) {
      const totales = await aligner.findMany({
        where: { clinicId, treatmentPlanId: { in: ids }, deletedAt: null },
        select: { treatmentPlanId: true, totalTrays: true },
      });
      for (const t of totales) {
        const p = salida.get(t.treatmentPlanId) ?? planDetalleVacio();
        salida.set(t.treatmentPlanId, { ...p, alineadoresTotales: t.totalTrays });
      }
    }
  } catch (e) {
    const code = (e as { code?: string } | null)?.code;
    if (code !== "P2021" && code !== "P2022") console.warn("[ortodoncia:plan] no se pudo leer el total de alineadores:", e);
  }
  return salida;
}

/** Mismo lector, para UN caso. `null` = el caso no tiene plan completo (o falta la columna). */
export async function cargarPlanDetalle(clinicId: string, planId: string, db?: LectorDelPlan): Promise<PlanDetalle | null> {
  return (await cargarPlanesDetalle(clinicId, [planId], db)).get(planId) ?? null;
}

/** Un motivo que se le dice a quien edita (y que deshace lo que se estaba guardando). */
export class ErrorDelPlan extends Error {}

/**
 * Lee, transforma y guarda el plan de UN caso bajo candado de fila (`FOR UPDATE`): dos cambios a la vez (el
 * editor y una hoja de control que marca una extracción) se serializan y no se pisan. `transformar` recibe el
 * plan tal cual está en la columna (sin fusionar con alineadores) y devuelve el nuevo. `alTerminar` corre en
 * la MISMA transacción (columnas de siempre, seguimiento de alineadores): si algo falla, nada queda a medias.
 * `sin-columna` = falta pegar el SQL; `invalido` = `transformar`/`alTerminar` lanzó un `ErrorDelPlan`.
 */
export async function actualizarPlanDetalle(
  clinicId: string,
  planId: string,
  transformar: (actual: PlanDetalle) => PlanDetalle,
  alTerminar?: (tx: Prisma.TransactionClient, antes: PlanDetalle, despues: PlanDetalle) => Promise<void>,
): Promise<
  | { ok: true; antes: PlanDetalle; despues: PlanDetalle }
  | { ok: false; motivo: "sin-columna" | "sin-caso" | "error" }
  | { ok: false; motivo: "invalido"; mensaje: string }
> {
  if (!clinicId || !planId) return { ok: false, motivo: "sin-caso" };
  if (!(await columnaDePlanDetalleExiste())) return { ok: false, motivo: "sin-columna" };
  try {
    return await prisma.$transaction(async (tx) => {
      const filas = (await tx.$queryRaw(Prisma.sql`
        SELECT "planDetalle" FROM "orthodontic_treatment_plans"
         WHERE "id" = ${planId} AND "clinicId" = ${clinicId} AND "deletedAt" IS NULL
         FOR UPDATE`)) as { planDetalle: unknown }[];
      if (filas.length === 0) return { ok: false as const, motivo: "sin-caso" as const };
      const antes = normalizarPlanDetalle(filas[0]!.planDetalle);
      const despues = normalizarPlanDetalle(transformar(antes));
      // Un plan vacío se guarda como NULL de SQL (el caso «sin plan completo»), no como el JSON `null`.
      const json = esPlanDetalleVacio(despues) ? null : JSON.stringify(despues);
      await tx.$executeRaw(Prisma.sql`
        UPDATE "orthodontic_treatment_plans"
           SET "planDetalle" = ${json}::jsonb, "updatedAt" = CURRENT_TIMESTAMP
         WHERE "id" = ${planId} AND "clinicId" = ${clinicId}`);
      if (alTerminar) await alTerminar(tx, antes, despues);
      return { ok: true as const, antes, despues };
    });
  } catch (e) {
    if (e instanceof ErrorDelPlan) return { ok: false, motivo: "invalido", mensaje: e.message };
    console.warn("[ortodoncia:plan] no se pudo guardar el plan:", e);
    return { ok: false, motivo: "error" };
  }
}

// ─── Listas de la clínica ───────────────────────────────────────────────

export interface OpcionesDeLaClinica {
  opciones: OpcionesDelPlan;
  /** false = falta pegar el SQL: se ven las de ejemplo y no se puede guardar. */
  columna: boolean;
  /** false = la clínica aún no editó ninguna lista (se ven las de ejemplo, sembradas). */
  editada: boolean;
}

/** Las listas de la clínica (`clinicId` de la sesión). Sin columna o sin fila: las de ejemplo. Nunca lanza. */
export async function leerOpcionesDelPlan(clinicId: string): Promise<OpcionesDeLaClinica> {
  const ejemplo: OpcionesDeLaClinica = { opciones: normalizarOpciones(null), columna: false, editada: false };
  if (!clinicId) return ejemplo;
  if (!(await columnaDeOpcionesExiste())) return ejemplo;
  try {
    const filas = await prisma.$queryRaw<{ planOptions: unknown }[]>`
      SELECT "planOptions" FROM "orthodontics_clinic_settings" WHERE "clinicId" = ${clinicId}`;
    const cruda = filas[0]?.planOptions ?? null;
    return { opciones: normalizarOpciones(cruda), columna: true, editada: opcionesEditadas(cruda) };
  } catch (e) {
    console.warn("[ortodoncia:plan] no se pudieron leer las listas:", e);
    return { ...ejemplo, columna: true };
  }
}

/** Guarda las listas (sustituyen las anteriores). `sin-columna` = falta pegar el SQL. */
export async function guardarOpcionesDelPlan(
  clinicId: string,
  userId: string,
  opciones: OpcionesDelPlan,
): Promise<{ ok: true; opciones: OpcionesDelPlan } | { ok: false; motivo: "sin-columna" | "sin-clinica" | "error" }> {
  if (!clinicId) return { ok: false, motivo: "sin-clinica" };
  if (!(await columnaDeOpcionesExiste())) return { ok: false, motivo: "sin-columna" };
  const limpias = normalizarOpciones(opciones);
  try {
    // La fila puede no existir aún (clínica que nunca guardó su Configuración): se crea con los defaults.
    await prisma.orthodonticsClinicSettings.upsert({
      where: { clinicId },
      create: { clinicId, updatedBy: userId },
      update: { updatedBy: userId },
    });
    const json = JSON.stringify(limpias);
    await prisma.$executeRaw`
      UPDATE "orthodontics_clinic_settings" SET "planOptions" = ${json}::jsonb, "updatedAt" = CURRENT_TIMESTAMP
       WHERE "clinicId" = ${clinicId}`;
    return { ok: true, opciones: limpias };
  } catch (e) {
    console.warn("[ortodoncia:plan] no se pudieron guardar las listas:", e);
    return { ok: false, motivo: "error" };
  }
}
