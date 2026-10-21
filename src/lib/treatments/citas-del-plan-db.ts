// Citas del plan en la base (ws1-t1 · fase 2 · P8): columna `treatment_plan_items."citaAgendadaId"`
// (sql/plan-tratamiento-citas.sql), por SQL crudo y SIN tocar el modelo de Prisma. Las reglas viven
// en `citas-del-plan.ts`; las filas, en `items-db.ts` (ws1-t12).
//
// Mientras la columna no exista, `citasDelPlanDisponible()` lo dice SIN consultarla (information_schema
// nunca falla) y lo recuerda en `globalThis` (sobrevive a las recargas de `next dev`): ni una consulta
// que falle en el log de Postgres de producción. Un «no está» se vuelve a preguntar a los 2 min.
//
// Toda consulta con sesión lleva `clinicId`, y sin él se corta ANTES de consultar. El cron no tiene
// sesión: pregunta por ids de plan y amarra fila ↔ plan ↔ cita por la MISMA clínica en el JOIN.

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { tablaDeFilasExiste } from "./items-db";
import type { DbDeFilas, EstadoDeFila } from "./items";
import { ESTADOS_DE_FILA } from "./items";
import type { CitaLigada, FilaParaLigar } from "./citas-del-plan";

const REPREGUNTAR_MS = 2 * 60_000;
const CLAVE = Symbol.for("dalecontrol.treatments.citas-del-plan-db");

type Sonda = { existe: boolean; en: number };

function memoria(): { columna?: Sonda } {
  const g = globalThis as unknown as Record<symbol, { columna?: Sonda } | undefined>;
  if (!g[CLAVE]) g[CLAVE] = {};
  return g[CLAVE]!;
}

/** Solo para las pruebas: olvida lo que se sabía de la columna. */
export function _olvidarSondaDeCitas(): void {
  delete memoria().columna;
}

async function columnaExiste(forzar: boolean): Promise<boolean> {
  const m = memoria();
  if (m.columna?.existe) return true;
  if (m.columna && !forzar && Date.now() - m.columna.en < REPREGUNTAR_MS) return false;
  try {
    const r = await prisma.$queryRaw<{ existe: boolean }[]>`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'treatment_plan_items' AND column_name = 'citaAgendadaId'
      ) AS existe`;
    const existe = r[0]?.existe === true;
    m.columna = { existe, en: Date.now() };
    return existe;
  } catch (e) {
    // Un fallo de la base no es «no existe», pero esta petición se porta como hoy (sin plan).
    console.warn("[plan:citas] no se pudo saber si existe la columna:", e);
    return false;
  }
}

/** ¿Están la tabla de filas Y la columna de la cita? Sin las dos, la agenda es la de siempre. */
export async function citasDelPlanDisponible(forzar = false): Promise<boolean> {
  if (!(await tablaDeFilasExiste(forzar))) return false;
  return columnaExiste(forzar);
}

function exigir(clinicId: string): void {
  if (typeof clinicId !== "string" || !clinicId) throw new Error("plan:citas: clinicId ausente — se corta antes de consultar");
}

const estadoDe = (v: string): EstadoDeFila =>
  (ESTADOS_DE_FILA as readonly string[]).indexOf(v) !== -1 ? (v as EstadoDeFila) : "pendiente";
const fecha = (v: Date | string): Date => (v instanceof Date ? v : new Date(v));

function citaDe(r: { citaId: string | null; citaInicio: Date | string | null; citaFin: Date | string | null; citaEstado: string | null }): CitaLigada | null {
  if (!r.citaId || !r.citaInicio || !r.citaFin || !r.citaEstado) return null;
  return { id: r.citaId, startsAt: fecha(r.citaInicio), endsAt: fecha(r.citaFin), status: r.citaEstado };
}

interface FilaConCitaSql {
  id: string;
  planId: string;
  estado: string;
  citaId: string | null;
  citaInicio: Date | string | null;
  citaFin: Date | string | null;
  citaEstado: string | null;
}

/**
 * Las filas pedidas, de ESTA clínica, con su plan (doctor, paciente, estado) y la cita en que están
 * agendadas. Dentro de la transacción de la cita y con las filas BLOQUEADAS: dos citas a la vez no se
 * llevan la misma fila. Las de otra clínica no llegan.
 *
 * Bloqueo y lectura van en DOS sentencias a propósito (revisión adversarial, 21-oct): en READ
 * COMMITTED, la sentencia que espera el `FOR UPDATE` devuelve la fila nueva pero ve el resto con su
 * foto de ANTES, así que la cita que la otra transacción acaba de crear no aparecía en el JOIN y la
 * fila salía «por agendar» → dos citas para el mismo procedimiento. La segunda sentencia toma foto
 * nueva y ya ve esa cita.
 */
export async function leerFilasParaLigar(db: DbDeFilas, clinicId: string, ids: string[]): Promise<FilaParaLigar[]> {
  exigir(clinicId);
  if (ids.length === 0) return [];
  await db.$queryRaw`
    SELECT "id" FROM "treatment_plan_items"
     WHERE "clinicId" = ${clinicId} AND "id" IN (${Prisma.join(ids)})
       FOR UPDATE`;
  const filas = await db.$queryRaw<Array<FilaConCitaSql & { planDoctorId: string; planPatientId: string; planStatus: string }>>`
    SELECT t."id", t."planId", t."estado",
           p."doctorId" AS "planDoctorId", p."patientId" AS "planPatientId", p."status"::text AS "planStatus",
           a."id" AS "citaId", a."startsAt" AS "citaInicio", a."endsAt" AS "citaFin", a."status"::text AS "citaEstado"
      FROM "treatment_plan_items" t
      JOIN "treatment_plans" p ON p."id" = t."planId" AND p."clinicId" = t."clinicId"
      LEFT JOIN "appointments" a ON a."id" = t."citaAgendadaId" AND a."clinicId" = t."clinicId"
     WHERE t."clinicId" = ${clinicId} AND t."id" IN (${Prisma.join(ids)})`;
  return filas.map((r) => ({
    id: r.id,
    planId: r.planId,
    estado: estadoDe(r.estado),
    planDoctorId: r.planDoctorId,
    planPatientId: r.planPatientId,
    planStatus: String(r.planStatus ?? ""),
    cita: citaDe(r),
  }));
}

/**
 * Liga las filas a la cita recién creada (misma transacción). Solo pendientes o en curso de ESTA
 * clínica; devuelve cuántas ligó — quien llama aborta si no son todas.
 */
export async function ligarFilasACita(
  db: DbDeFilas,
  args: { clinicId: string; appointmentId: string; ids: string[]; userId: string | null },
): Promise<number> {
  exigir(args.clinicId);
  if (args.ids.length === 0) return 0;
  return db.$executeRaw`
    UPDATE "treatment_plan_items"
       SET "citaAgendadaId" = ${args.appointmentId}, "agendadaEn" = now(), "agendadaPor" = ${args.userId}, "updatedAt" = now()
     WHERE "clinicId" = ${args.clinicId} AND "id" IN (${Prisma.join(args.ids)})
       AND "estado" IN ('pendiente', 'en_curso')`;
}

/** Una fila del plan tal como la pinta «Agendar lo pendiente». */
export interface FilaParaAgendar {
  id: string;
  nombre: string;
  dientes: number[];
  caras: string[];
  estado: EstadoDeFila;
  cantidad: number;
  /** Duración del tarifario (minutos), o null si no la tiene. */
  minutos: number | null;
  cita: CitaLigada | null;
  orden: number;
}

/** Filas vivas del plan (de ESTA clínica), con la duración del tarifario y la cita en que están. */
export async function filasDelPlanParaAgendar(clinicId: string, planId: string): Promise<FilaParaAgendar[]> {
  exigir(clinicId);
  if (typeof planId !== "string" || !planId) throw new Error("plan:citas: planId ausente — se corta antes de consultar");
  const filas = await prisma.$queryRaw<
    Array<FilaConCitaSql & { nombre: string; dientes: number[] | null; caras: string[] | null; cantidad: number; minutos: number | null; orden: number }>
  >`
    SELECT t."id", t."planId", t."estado", t."nombre", t."dientes", t."caras", t."cantidad", t."orden",
           pc."duration" AS "minutos",
           a."id" AS "citaId", a."startsAt" AS "citaInicio", a."endsAt" AS "citaFin", a."status"::text AS "citaEstado"
      FROM "treatment_plan_items" t
      LEFT JOIN "procedure_catalog" pc ON pc."id" = t."procedureId" AND pc."clinicId" = t."clinicId"
      LEFT JOIN "appointments" a ON a."id" = t."citaAgendadaId" AND a."clinicId" = t."clinicId"
     WHERE t."clinicId" = ${clinicId} AND t."planId" = ${planId} AND t."estado" <> 'cancelado'
     ORDER BY t."orden", t."createdAt", t."id"`;
  return filas.map((r) => ({
    id: r.id,
    nombre: r.nombre,
    dientes: (r.dientes ?? []).map(Number),
    caras: (r.caras ?? []).map(String),
    estado: estadoDe(r.estado),
    cantidad: Number(r.cantidad) || 1,
    minutos: r.minutos == null ? null : Number(r.minutos),
    cita: citaDe(r),
    orden: Number(r.orden) || 0,
  }));
}

/**
 * Las filas del plan (no canceladas) agendadas en ESTA cita, de ESTA clínica. Para quien cobra desde la
 * cita («Cobrar hoy», ws1-t12): si la cita trae filas del plan, lo de hoy es un abono a la nota del
 * plan, no un concepto nuevo. [] sin el SQL (y entonces no consulta la tabla).
 */
export async function filasAgendadasEnCita(
  clinicId: string,
  appointmentId: string,
): Promise<Array<{ id: string; planId: string; nombre: string; dientes: number[]; estado: EstadoDeFila; cantidad: number; minutos: number | null; invoiceId: string | null }>> {
  exigir(clinicId);
  if (typeof appointmentId !== "string" || !appointmentId) return [];
  if (!(await citasDelPlanDisponible())) return [];
  const filas = await prisma.$queryRaw<
    Array<{ id: string; planId: string; nombre: string; dientes: number[] | null; estado: string; cantidad: number; minutos: number | null; invoiceId: string | null }>
  >`
    SELECT t."id", t."planId", t."nombre", t."dientes", t."estado", t."cantidad", pc."duration" AS "minutos", t."invoiceId"
      FROM "treatment_plan_items" t
      LEFT JOIN "procedure_catalog" pc ON pc."id" = t."procedureId" AND pc."clinicId" = t."clinicId"
     WHERE t."clinicId" = ${clinicId} AND t."citaAgendadaId" = ${appointmentId} AND t."estado" <> 'cancelado'
     ORDER BY t."orden", t."createdAt", t."id"`;
  return filas.map((r) => ({
    id: r.id,
    planId: r.planId,
    nombre: r.nombre,
    dientes: (r.dientes ?? []).map(Number),
    estado: estadoDe(r.estado),
    cantidad: Number(r.cantidad) || 1,
    minutos: r.minutos == null ? null : Number(r.minutos),
    invoiceId: r.invoiceId ?? null,
  }));
}

/** Una fila para el seguimiento (cron, sin sesión). */
export interface FilaParaSeguimiento {
  planId: string;
  estado: EstadoDeFila;
  cantidad: number;
  hechoEn: Date | null;
  /** En una nota de cobro del plan = el plan se aceptó. */
  invoiceId: string | null;
  cita: CitaLigada | null;
}

/**
 * Filas de varios planes, para el cron, CANCELADAS INCLUIDAS (un plan con filas, aunque estén todas
 * canceladas, es un plan nuevo y no vuelve a la regla por intervalo). Sin sesión: la clínica sale del
 * propio plan y la fila y la cita tienen que ser de esa MISMA clínica (JOIN por "clinicId").
 */
export async function filasParaSeguimiento(planIds: string[]): Promise<Map<string, FilaParaSeguimiento[]>> {
  const out = new Map<string, FilaParaSeguimiento[]>();
  const ids = Array.from(new Set(planIds.filter((x) => typeof x === "string" && x)));
  if (ids.length === 0) return out;
  const filas = await prisma.$queryRaw<Array<FilaConCitaSql & { cantidad: number; hechoEn: Date | string | null; invoiceId: string | null }>>`
    SELECT t."id", t."planId", t."estado", t."cantidad", t."hechoEn", t."invoiceId",
           a."id" AS "citaId", a."startsAt" AS "citaInicio", a."endsAt" AS "citaFin", a."status"::text AS "citaEstado"
      FROM "treatment_plan_items" t
      JOIN "treatment_plans" p ON p."id" = t."planId" AND p."clinicId" = t."clinicId"
      LEFT JOIN "appointments" a ON a."id" = t."citaAgendadaId" AND a."clinicId" = t."clinicId"
     WHERE t."planId" IN (${Prisma.join(ids)})`;
  for (const r of filas) {
    const lista = out.get(r.planId) ?? [];
    lista.push({
      planId: r.planId,
      estado: estadoDe(r.estado),
      cantidad: Number(r.cantidad) || 1,
      hechoEn: r.hechoEn ? fecha(r.hechoEn) : null,
      invoiceId: r.invoiceId ?? null,
      cita: citaDe(r),
    });
    out.set(r.planId, lista);
  }
  return out;
}
