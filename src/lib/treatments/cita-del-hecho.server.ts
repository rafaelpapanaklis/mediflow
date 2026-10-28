// «Hecho» pregunta en qué cita se hizo (v17, decisión 1 de Rafael): las citas que se ofrecen y si
// tienen nota clínica. Reglas en `cita-del-hecho.ts`. Todo por `clinicId` de la sesión Y el paciente
// del plan; SQL crudo, como el resto de «hecho».

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isClinicalNoteEmpty } from "@/lib/clinical/note-validation";
import { diaEnZona } from "@/lib/fechas/fecha-en-zona";
import { notaLigable, ordenarCitasParaHecho, type CitaParaHecho, type MomentoDeLaCita } from "./cita-del-hecho";
import { tablaDeFilasExiste } from "./items-db";

/** Hasta cuántos días atrás se ofrecen citas (lo hecho se marca el día o pocos días después). */
export const DIAS_ATRAS = 60;
export const MAX_CITAS = 12;

/** Las citas del paciente con nota clínica con algo escrito, de entre `ids`. */
export async function citasConNota(clinicId: string, patientId: string, ids: string[]): Promise<Set<string>> {
  if (!clinicId) throw new Error("plan:hecho: clinicId ausente — se corta antes de consultar");
  const unicos = Array.from(new Set(ids.filter((x) => typeof x === "string" && x)));
  if (unicos.length === 0) return new Set();
  // `specialtyData.appointmentId` es como «Completar consulta» encuentra la nota de la cita. Una nota
  // privada de otro doctor también cuenta: aquí solo se dice si la hay, nunca qué dice.
  const notas = await prisma.$queryRaw<Array<{ cita: string; subjective: string | null; objective: string | null; assessment: string | null; plan: string | null; specialtyData: unknown }>>`
    SELECT "specialtyData"->>'appointmentId' AS "cita", "subjective", "objective", "assessment", "plan", "specialtyData"
      FROM "medical_records"
     WHERE "clinicId" = ${clinicId} AND "patientId" = ${patientId}
       AND "specialtyData"->>'appointmentId' IN (${Prisma.join(unicos)})`;
  const con = new Set<string>();
  for (const n of notas) {
    const spec = typeof n.specialtyData === "string" ? (() => { try { return JSON.parse(n.specialtyData as string); } catch { return null; } })() : n.specialtyData;
    if (n.cita && !isClinicalNoteEmpty({ ...n, specialtyData: spec })) con.add(n.cita);
  }
  return con;
}

/**
 * Las citas recientes del paciente para elegir en «Hecho»: de los últimos `DIAS_ATRAS` días hasta el
 * fin de hoy, sin las canceladas ni las de «no vino». Las de hoy primero.
 */
export async function citasParaHecho(
  clinicId: string,
  patientId: string,
  opciones: { ahora?: Date; timezone?: string | null; quienPregunta?: string } = {},
): Promise<CitaParaHecho[]> {
  if (!clinicId) throw new Error("plan:hecho: clinicId ausente — se corta antes de consultar");
  const ahora = opciones.ahora ?? new Date();
  const zona = opciones.timezone ?? null;
  const desde = new Date(ahora.getTime() - DIAS_ATRAS * 86_400_000);
  // Hasta mañana a esta hora: cubre «hoy» en cualquier zona; lo de mañana se quita abajo.
  const hasta = new Date(ahora.getTime() + 86_400_000);
  const filas = await prisma.$queryRaw<Array<{ id: string; startsAt: Date | string; status: string; doctorId: string | null; tipo: string | null; nombre: string | null; apellido: string | null }>>`
    SELECT a."id", a."startsAt", a."status"::text AS "status", a."doctorId", a."type" AS "tipo", u."firstName" AS "nombre", u."lastName" AS "apellido"
      FROM "appointments" a
      LEFT JOIN "users" u ON u."id" = a."doctorId" AND u."clinicId" = a."clinicId"
     WHERE a."clinicId" = ${clinicId} AND a."patientId" = ${patientId}
       AND a."startsAt" >= ${desde} AND a."startsAt" < ${hasta}
       AND a."status"::text NOT IN ('CANCELLED', 'NO_SHOW')
     ORDER BY a."startsAt" DESC
     LIMIT ${MAX_CITAS * 2}`;
  const hoy = diaEnZona(ahora, zona);
  const citas = filas
    .map((f) => {
      const inicio = f.startsAt instanceof Date ? f.startsAt : new Date(f.startsAt);
      const doctor = [f.nombre, f.apellido].filter((x) => typeof x === "string" && x.trim()).join(" ").trim();
      return {
        id: f.id,
        startsAt: inicio.toISOString(),
        status: String(f.status),
        doctor: doctor || null,
        motivo: f.tipo?.trim() || null,
        esHoy: diaEnZona(inicio, zona) === hoy,
        tieneNota: false,
        notaLigable: notaLigable({ status: String(f.status), doctorId: f.doctorId ?? null, momento: momentoDe(inicio, ahora, zona) }, opciones.quienPregunta ?? ""),
      };
    })
    // Lo de días que aún no llegan, fuera (una cita de mañana no es donde se hizo).
    .filter((c) => c.esHoy || Date.parse(c.startsAt) <= ahora.getTime());
  const elegidas = ordenarCitasParaHecho(citas).slice(0, MAX_CITAS);
  const conNota = await citasConNota(clinicId, patientId, elegidas.map((c) => c.id));
  return elegidas.map((c) => ({ ...c, tieneNota: conNota.has(c.id) }));
}

/** «hoy» en la zona de la clínica; si no, antes o después de ahora. */
function momentoDe(inicio: Date, ahora: Date, zona: string | null): MomentoDeLaCita {
  if (diaEnZona(inicio, zona) === diaEnZona(ahora, zona)) return "hoy";
  return inicio.getTime() < ahora.getTime() ? "pasado" : "futuro";
}

export type CitaParaLaNota = { ok: true } | { ok: false; motivo: "no_existe" | "sin_hecho" | "no_ligable" };

/**
 * v18 (t5 de la v17, m2): ¿la nota nueva de `quienEscribe` se puede ligar EXPLÍCITAMENTE a esta cita?
 * Lo pide «Marcar y escribir la nota» (POST /api/clinical con `citaElegida: true`). Además de `notaLigable`:
 *  · la cita es de ESTA clínica y de ESTE paciente;
 *  · en ella se marcó «Hecho» algo del plan (la nota respalda ese procedimiento: el enlace explícito no sirve
 *    para colgar notas de cualquier cita).
 * Los permisos (`medicalRecord.edit`, visibilidad del paciente) los pone la ruta, como siempre.
 */
export async function citaParaLaNota(args: {
  clinicId: string;
  patientId: string;
  appointmentId: string;
  quienEscribe: string;
  timezone: string | null;
  ahora?: Date;
}): Promise<CitaParaLaNota> {
  const { clinicId, patientId, appointmentId, quienEscribe } = args;
  if (!clinicId) throw new Error("plan:hecho: clinicId ausente — se corta antes de consultar");
  const cita = await prisma.$queryRaw<Array<{ status: string; doctorId: string | null; startsAt: Date | string }>>`
    SELECT "status"::text AS "status", "doctorId", "startsAt" FROM "appointments"
     WHERE "id" = ${appointmentId} AND "clinicId" = ${clinicId} AND "patientId" = ${patientId}`;
  if (cita.length !== 1) return { ok: false, motivo: "no_existe" };
  const inicio = cita[0].startsAt instanceof Date ? cita[0].startsAt : new Date(cita[0].startsAt);
  const momento = momentoDe(inicio, args.ahora ?? new Date(), args.timezone);
  if (!notaLigable({ status: String(cita[0].status), doctorId: cita[0].doctorId ?? null, momento }, quienEscribe)) return { ok: false, motivo: "no_ligable" };
  if (!(await tablaDeFilasExiste())) return { ok: false, motivo: "sin_hecho" };
  const hecho = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "treatment_plan_items"
     WHERE "clinicId" = ${clinicId} AND "citaId" = ${appointmentId} AND "estado" = 'hecho'
     LIMIT 1`;
  return hecho.length === 1 ? { ok: true } : { ok: false, motivo: "sin_hecho" };
}
