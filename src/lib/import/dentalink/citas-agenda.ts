// Lo que las citas importadas de Dentalink necesitan de la AGENDA (ws1-t10, 29-sep-2026): cuánto duran, en qué
// consultorio caen y si chocan con otra. Compartido por el handler de citas vivas (entities.ts) y el del historial, que
// crea la cita COMPLETADA de un control de ortodoncia.
//
// Multi-tenant: clinicId SIEMPRE de la sesión.

import { prisma } from "@/lib/prisma";
import { parseDate } from "../engine";
import { cellText } from "../migrado";
import { horaLocalAUtc, parseHora, textoLocal } from "../valores";
import type { RecursoDeClinica } from "./citas";

export const DURACION_POR_DEFECTO_MIN = 30;

function parseDuration(v: unknown): number {
  if (v === undefined || v === null || String(v).trim() === "") return DURACION_POR_DEFECTO_MIN;
  const n = parseInt(String(v).replace(/[^0-9]/g, ""), 10);
  return Number.isFinite(n) && n > 0 && n <= 600 ? n : DURACION_POR_DEFECTO_MIN;
}

/** Una celda para un mensaje (las fechas de .xlsx llegan como Date). */
function verTexto(v: unknown): string {
  if (v instanceof Date) return `${String(v.getDate()).padStart(2, "0")}/${String(v.getMonth() + 1).padStart(2, "0")}/${v.getFullYear()}`;
  return cellText(v);
}

/**
 * Cuánto dura la cita: 1) la columna «Duración» si viene; 2) si no, hora de fin − hora de inicio (la misma fecha, en la
 * zona de la clínica); 3) 30 min. Una hora de fin ilegible o que no es posterior al inicio NO se adivina: se usan
 * 30 min y se avisa en esa fila.
 */
export function leerDuracionDeCita(
  mapped: Record<string, any>,
  startsAt: Date | undefined,
  timezone: string | null | undefined,
): { min: number; warning?: string } {
  if (mapped.duration !== undefined && mapped.duration !== null && String(mapped.duration).trim() !== "") {
    return { min: parseDuration(mapped.duration) };
  }
  if (mapped.endTime === undefined || mapped.endTime === null || cellText(mapped.endTime) === "") return { min: DURACION_POR_DEFECTO_MIN };
  const fin = parseHora(mapped.endTime);
  const fecha = parseDate(mapped.date);
  const aviso = (motivo: string) => ({
    min: DURACION_POR_DEFECTO_MIN,
    warning: `Hora de fin "${verTexto(mapped.endTime)}" ${motivo}: la cita dura ${DURACION_POR_DEFECTO_MIN} min`,
  });
  if (!fin || !fecha || !startsAt) return aviso("ilegible");
  const finUtc = horaLocalAUtc(fecha.getFullYear(), fecha.getMonth() + 1, fecha.getDate(), fin.h, fin.m, timezone);
  if (!finUtc) return aviso("no existe en la zona horaria de la clínica");
  const min = Math.round((finUtc.getTime() - startsAt.getTime()) / 60_000);
  if (min <= 0) return aviso("no es posterior al inicio");
  if (min > 600) return aviso("deja la cita en más de 10 horas");
  return { min };
}

/** Los consultorios/sillones activos de la clínica (tolera que la tabla no exista). */
export async function cargarRecursos(clinicId: string): Promise<RecursoDeClinica[]> {
  if (typeof clinicId !== "string" || !clinicId) throw new Error("cargarRecursos: falta clinicId");
  try {
    const rows = await prisma.resource.findMany({
      where: { clinicId, isActive: true },
      select: { id: true, name: true, kind: true },
      orderBy: { orderIndex: "asc" },
    });
    return rows.map((r) => ({ id: r.id, name: r.name, kind: String(r.kind) }));
  } catch (e) {
    const code = (e as { code?: string } | null)?.code;
    if (code === "P2021" || code === "P2022") return [];
    throw e;
  }
}

export interface Ocupada {
  doctorId: string;
  resourceId: string | null;
  patientId: string;
  startsAt: Date;
  endsAt: Date;
}

export const solapa = (a: { startsAt: Date; endsAt: Date }, b: { startsAt: Date; endsAt: Date }) =>
  a.startsAt < b.endsAt && b.startsAt < a.endsAt;

/**
 * Las citas de la agenda que OCUPAN su hora (no canceladas ni «no asistió», ni apartados vencidos) y se cruzan con
 * [desde, hasta) — de estos doctores o de estos consultorios. Es lo mismo que cuentan las constraints de la agenda.
 */
export async function cargarOcupadas(
  clinicId: string,
  doctorIds: string[],
  resourceIds: string[],
  desde: Date,
  hasta: Date,
): Promise<Ocupada[]> {
  if (typeof clinicId !== "string" || !clinicId) throw new Error("cargarOcupadas: falta clinicId");
  if (doctorIds.length === 0 && resourceIds.length === 0) return [];
  const filas: Array<{
    doctorId: string; resourceId: string | null; patientId: string; startsAt: Date; endsAt: Date; status: string; holdExpiresAt: Date | null;
  }> = await prisma.appointment.findMany({
    where: { clinicId, startsAt: { lt: hasta }, endsAt: { gt: desde } },
    select: { doctorId: true, resourceId: true, patientId: true, startsAt: true, endsAt: true, status: true, holdExpiresAt: true },
  });
  const ahora = new Date();
  const doctores = new Set(doctorIds);
  const recursos = new Set(resourceIds);
  return filas
    .filter((a) => a.status !== "CANCELLED" && a.status !== "NO_SHOW" && !(a.status === "SCHEDULED" && a.holdExpiresAt && a.holdExpiresAt < ahora))
    .filter((a) => doctores.has(a.doctorId) || (a.resourceId !== null && recursos.has(a.resourceId)))
    .map((a) => ({ doctorId: a.doctorId, resourceId: a.resourceId, patientId: a.patientId, startsAt: a.startsAt, endsAt: a.endsAt }));
}

/** «10:30–11:00» en la zona de la clínica, para los mensajes. */
export function tramoLocal(a: { startsAt: Date; endsAt: Date }, tz: string | null): string {
  return `${textoLocal(a.startsAt, tz).slice(11)}–${textoLocal(a.endsAt, tz).slice(11)}`;
}

/**
 * Lleva cada cita al consultorio que eligió `data.resourceId` SOLO si ese consultorio está libre a esa hora (ni la
 * agenda ni otra cita del mismo archivo lo ocupan): la agenda tiene una constraint por consultorio igual a la del
 * doctor, y una cita que la rompe no se guarda. Si choca, la cita entra SIN consultorio (no se mueve ningún horario) y
 * se dice en la nota y en un aviso. Muta `data.resourceId` / `notes` / `warnings` de las filas dadas (ya aceptadas).
 */
export function soltarConsultoriosQueChocan(
  filas: Array<{ data: Record<string, any>; warnings: string[] }>,
  ocupadas: Ocupada[],
  tz: string | null,
): number {
  let soltados = 0;
  const aceptadas: Array<{ resourceId: string; startsAt: Date; endsAt: Date }> = [];
  for (const f of filas) {
    const rid = f.data.resourceId as string | null | undefined;
    if (!rid) continue;
    const cita = { startsAt: f.data.startsAt as Date, endsAt: f.data.endsAt as Date };
    const choca =
      ocupadas.some((o) => o.resourceId === rid && solapa(cita, o)) ||
      aceptadas.some((o) => o.resourceId === rid && solapa(cita, o));
    if (choca) {
      f.data.resourceId = null;
      f.data.consultorioSoltado = true;
      f.warnings.push(`El consultorio está ocupado a esa hora (${tramoLocal(cita, tz)}): la cita entra sin consultorio, sin mover el horario`);
      soltados++;
    } else {
      aceptadas.push({ resourceId: rid, ...cita });
    }
  }
  return soltados;
}
