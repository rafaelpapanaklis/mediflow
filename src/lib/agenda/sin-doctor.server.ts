/**
 * ¿Ya se pegó `sql/cita-sin-doctor.sql`? (ws1-t11 · fase 2 · P1)
 *
 * Mientras `appointments."doctorId"` siga NOT NULL, una cita «Sin doctor»
 * acabaría en un 23502 de Postgres a media transacción. Con esto, la pantalla
 * no ofrece la opción y el servidor contesta con un 409 que dice qué falta.
 *
 * Se pregunta a `information_schema` (no falla ni deja errores en el log de
 * Postgres) y la respuesta vive 10 min en `globalThis`, como
 * src/lib/google/tablas.server.ts. `forzar` vuelve a preguntar: lo usa el alta
 * cuando la memoria dice «no», para que pegar el SQL valga al instante.
 *
 * Sin `server-only` a propósito: las pruebas lo importan con un doble de base.
 */

export interface DbSonda {
  $queryRaw(query: TemplateStringsArray, ...values: unknown[]): Promise<unknown>;
}

import { sinApartadoVencido } from "./apartado";
import { datosDeSobreturno, type DatosDeSobreturno } from "./sin-doctor";
import { RECIBE_CITAS_WHERE } from "./roles-que-atienden";

const DIEZ_MIN = 10 * 60 * 1000;
const CLAVE = Symbol.for("dalecontrol.ws1-t11.cita-sin-doctor");

type Memoria = { si: boolean; at: number } | undefined;
const leer = (): Memoria => (globalThis as unknown as Record<symbol, Memoria>)[CLAVE];
const fijar = (m: Memoria): void => {
  (globalThis as unknown as Record<symbol, Memoria>)[CLAVE] = m;
};

async function preguntar(db: DbSonda): Promise<boolean> {
  const filas = (await db.$queryRaw`
    SELECT (is_nullable = 'YES') AS si
      FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'appointments' AND column_name = 'doctorId'`) as { si: boolean }[];
  return Array.isArray(filas) && filas[0]?.si === true;
}

/** ¿Se pueden guardar citas sin doctor? Ante un fallo de la base, lo último que se supo (o «no»). */
export async function sinDoctorDisponible(opts: { db?: DbSonda; forzar?: boolean } = {}): Promise<boolean> {
  const m = leer();
  if (!opts.forzar && m && Date.now() - m.at < DIEZ_MIN) return m.si;
  try {
    const db = opts.db ?? ((await import("@/lib/prisma")).prisma as unknown as DbSonda);
    const si = await preguntar(db);
    fijar({ si, at: Date.now() });
    return si;
  } catch {
    return m?.si ?? false;
  }
}

/** Para el alta: si la memoria dice «no», se vuelve a preguntar (alguien pudo pegar el SQL hace un momento). */
export async function sinDoctorDisponibleAlGuardar(opts: { db?: DbSonda } = {}): Promise<boolean> {
  const m = leer();
  if (m?.si && Date.now() - m.at < DIEZ_MIN) return true;
  return sinDoctorDisponible({ ...opts, forzar: true });
}

/** Lo que hay que añadir al UPDATE que cierra la cita: el doctor y, si choca, el sobreturno. Vacío = nada. */
export interface AsignacionAlCerrar {
  datos: { doctorId?: string } & DatosDeSobreturno;
  /** La otra cita del doctor con la que quedó encima (para el rastro); null si no choca. */
  conCita: string | null;
}

/**
 * ws1-t11 (D9) — el cierre que no pasa por /status ni /complete (firmar o ligar la hoja de control
 * de ortodoncia): si la cita sigue «Sin doctor», queda a nombre de quien la atendió (`doctorId`).
 * Se calcula ANTES y va en el MISMO update que cierra la cita (v2, revisión de t12: antes eran dos
 * escrituras y un fallo de la segunda dejaba la cita atendida y «Sin doctor» sin aviso).
 *  · v2 (m5): quien atendió tiene que recibir citas en la clínica (`RECIBE_CITAS_WHERE`); si no, nada.
 *  · v2 (M1/m1): si ya tiene otra cita viva a esa hora (también una sobreagendada, que la constraint
 *    no ve), la cita entra como sobreturno (`datosDeSobreturno`, a nombre de quien ACTÚA).
 * Nunca lanza: ante un fallo, nada (la cita se cierra «Sin doctor», como antes de existir esto).
 */
export async function asignacionAlCerrar(
  db: { appointment: { findFirst(args: any): Promise<any> }; user: { findFirst(args: any): Promise<any> } },
  args: { clinicId: string; appointmentId: string; doctorId: string | null | undefined; actorId: string },
): Promise<AsignacionAlCerrar> {
  const nada: AsignacionAlCerrar = { datos: {}, conCita: null };
  if (!args.clinicId || !args.appointmentId || !args.doctorId) return nada;
  try {
    const cita = await db.appointment.findFirst({
      where: { id: args.appointmentId, clinicId: args.clinicId, doctorId: null },
      select: { startsAt: true, endsAt: true, overrideReason: true },
    });
    if (!cita) return nada;
    const atiende = await db.user.findFirst({
      where: { id: args.doctorId, clinicId: args.clinicId, ...RECIBE_CITAS_WHERE },
      select: { id: true },
    });
    if (!atiende) return nada;
    const otra = await db.appointment.findFirst({
      where: {
        clinicId: args.clinicId,
        doctorId: args.doctorId,
        id: { not: args.appointmentId },
        status: { notIn: ["CANCELLED", "NO_SHOW"] },
        startsAt: { lt: cita.endsAt },
        endsAt: { gt: cita.startsAt },
        AND: [sinApartadoVencido()],
      },
      select: { id: true },
    });
    return {
      datos: { doctorId: args.doctorId, ...(otra ? datosDeSobreturno(cita.overrideReason, args.actorId, new Date()) : {}) },
      conCita: otra?.id ?? null,
    };
  } catch (e) {
    console.warn("[cita-sin-doctor] no se pudo decidir el doctor al cerrar:", e);
    return nada;
  }
}

/** La fila de Movimientos de esa asignación (después de que el cierre se escribió). Nunca lanza. */
export async function rastroDeAsignacionAlCerrar(args: {
  clinicId: string;
  actorId: string;
  patientId: string;
  appointmentId: string;
  asignacion: AsignacionAlCerrar;
}): Promise<void> {
  const doctorId = args.asignacion.datos.doctorId;
  if (!doctorId) return;
  try {
    const { registrarMovimientoDelPaciente } = await import("@/lib/movimientos-paciente/registrar");
    await registrarMovimientoDelPaciente({
      clinicId: args.clinicId,
      userId: args.actorId,
      patientId: args.patientId,
      entityType: "appointment",
      entityId: args.appointmentId,
      action: "update",
      texto: "La cita quedó a nombre de quien firmó la hoja de control",
      campos: args.asignacion.conCita ? ["doctorId", "overrideReason"] : ["doctorId"],
      cambios: {
        doctorId: { before: null, after: doctorId },
        ...(args.asignacion.conCita ? { sobreturno: { before: null, after: { conCita: args.asignacion.conCita, doctorId } } } : {}),
      },
    });
  } catch (e) {
    console.warn("[cita-sin-doctor] no se pudo dejar el rastro de la asignación:", e);
  }
}

/** Solo pruebas. */
export function _olvidarSinDoctor(): void {
  fijar(undefined);
}
