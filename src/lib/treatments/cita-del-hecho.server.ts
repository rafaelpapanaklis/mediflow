// «Hecho» pregunta en qué cita se hizo (v17, decisión 1 de Rafael): las citas que se ofrecen y si
// tienen nota clínica. Reglas en `cita-del-hecho.ts`. Todo por `clinicId` de la sesión Y el paciente
// del plan; SQL crudo, como el resto de «hecho».

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isClinicalNoteEmpty } from "@/lib/clinical/note-validation";
import { diaEnZona } from "@/lib/fechas/fecha-en-zona";
import { ordenarCitasParaHecho, type CitaParaHecho } from "./cita-del-hecho";

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
  opciones: { ahora?: Date; timezone?: string | null } = {},
): Promise<CitaParaHecho[]> {
  if (!clinicId) throw new Error("plan:hecho: clinicId ausente — se corta antes de consultar");
  const ahora = opciones.ahora ?? new Date();
  const zona = opciones.timezone ?? null;
  const desde = new Date(ahora.getTime() - DIAS_ATRAS * 86_400_000);
  // Hasta mañana a esta hora: cubre «hoy» en cualquier zona; lo de mañana se quita abajo.
  const hasta = new Date(ahora.getTime() + 86_400_000);
  const filas = await prisma.$queryRaw<Array<{ id: string; startsAt: Date | string; status: string; tipo: string | null; nombre: string | null; apellido: string | null }>>`
    SELECT a."id", a."startsAt", a."status"::text AS "status", a."type" AS "tipo", u."firstName" AS "nombre", u."lastName" AS "apellido"
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
      };
    })
    // Lo de días que aún no llegan, fuera (una cita de mañana no es donde se hizo).
    .filter((c) => c.esHoy || Date.parse(c.startsAt) <= ahora.getTime());
  const elegidas = ordenarCitasParaHecho(citas).slice(0, MAX_CITAS);
  const conNota = await citasConNota(clinicId, patientId, elegidas.map((c) => c.id));
  return elegidas.map((c) => ({ ...c, tieneNota: conNota.has(c.id) }));
}
