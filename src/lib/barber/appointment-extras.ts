// ═══════════════════════════════════════════════════════════════════════
// DaleControl BARBER — lo NUEVO de la cita «B» que vive fuera del schema.
//
// Dos columnas de barber_appointments que crea sql/barber_cita_b.sql y que
// NO están en prisma/schema.prisma (el cliente las pediría en cada lectura de
// citas y una base sin el SQL tumbaría la agenda):
//   · "cancelReason" — motivo de la cancelación.
//   · "arrivedAt"    — «Ya llegó».
// Se leen y escriben con SQL crudo, siempre con el barbershopId de la sesión,
// y TODO degrada: sin la columna, leer devuelve vacío y escribir devuelve
// false (nunca lanza por eso).
//
// Sin "server-only" ni prisma propio: recibe el cliente (o un tx). Así lo
// prueban las pruebas en Node pelado.
// ═══════════════════════════════════════════════════════════════════════
import type { Prisma } from "@prisma/client";
import { isMissingColumnError } from "@/lib/barber/db-errors";

export const CANCEL_REASON_MAX = 200;

type RawDb = Pick<Prisma.TransactionClient, "$queryRaw" | "$executeRaw">;

export class AppointmentExtrasInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AppointmentExtrasInputError";
  }
}

/**
 * Motivo de cancelación tal como llega del navegador: opcional, sin saltos de
 * línea de sobra, hasta 200 caracteres. Más largo → error (no se recorta en
 * silencio un texto que la persona escribió).
 */
export function cleanCancelReason(raw: unknown): string | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "string") throw new AppointmentExtrasInputError("El motivo tiene que ser texto.");
  const text = raw.replace(/\s+/g, " ").trim();
  if (!text) return null;
  if (text.length > CANCEL_REASON_MAX) {
    throw new AppointmentExtrasInputError(`El motivo va hasta ${CANCEL_REASON_MAX} caracteres.`);
  }
  return text;
}

/** Guarda (o borra, con null) el motivo. false = la columna aún no existe. */
export async function saveCancelReason(
  db: RawDb,
  args: { barbershopId: string; appointmentId: string; reason: string | null },
): Promise<boolean> {
  if (!args.barbershopId || !args.appointmentId) return false;
  try {
    await db.$executeRaw`
      UPDATE "barber_appointments" SET "cancelReason" = ${args.reason}::text
      WHERE "id" = ${args.appointmentId} AND "barbershopId" = ${args.barbershopId}`;
    return true;
  } catch (e) {
    if (isMissingColumnError(e)) return false;
    throw e;
  }
}

/** «Ya llegó» (fecha) o quitarlo (null). false = la columna aún no existe. */
export async function saveArrivedAt(
  db: RawDb,
  args: { barbershopId: string; appointmentId: string; at: Date | null },
): Promise<boolean> {
  if (!args.barbershopId || !args.appointmentId) return false;
  try {
    await db.$executeRaw`
      UPDATE "barber_appointments" SET "arrivedAt" = ${args.at}::timestamp(3)
      WHERE "id" = ${args.appointmentId} AND "barbershopId" = ${args.barbershopId}`;
    return true;
  } catch (e) {
    if (isMissingColumnError(e)) return false;
    throw e;
  }
}

export interface AppointmentExtras {
  cancelReason: string | null;
  arrivedAt: string | null;
}

/**
 * Los extras de VARIAS citas en una sola ida por columna (la agenda pide un
 * día o una semana entera). Sin la columna, esa parte sale vacía.
 */
export async function readAppointmentExtras(
  db: RawDb,
  barbershopId: string,
  ids: string[],
): Promise<Map<string, AppointmentExtras>> {
  const out = new Map<string, AppointmentExtras>();
  const unique = Array.from(new Set(ids.filter(Boolean)));
  if (!barbershopId || unique.length === 0) return out;
  const get = (id: string) => {
    const cur = out.get(id) ?? { cancelReason: null, arrivedAt: null };
    out.set(id, cur);
    return cur;
  };

  try {
    const rows = await db.$queryRaw<Array<{ id: string; cancelReason: string | null }>>`
      SELECT "id", "cancelReason" FROM "barber_appointments"
      WHERE "barbershopId" = ${barbershopId} AND "id" = ANY(${unique}::text[]) AND "cancelReason" IS NOT NULL`;
    for (const r of rows) get(r.id).cancelReason = r.cancelReason;
  } catch (e) {
    if (!isMissingColumnError(e)) throw e;
  }
  try {
    const rows = await db.$queryRaw<Array<{ id: string; arrivedAt: Date | null }>>`
      SELECT "id", "arrivedAt" FROM "barber_appointments"
      WHERE "barbershopId" = ${barbershopId} AND "id" = ANY(${unique}::text[]) AND "arrivedAt" IS NOT NULL`;
    for (const r of rows) get(r.id).arrivedAt = r.arrivedAt ? new Date(r.arrivedAt).toISOString() : null;
  } catch (e) {
    if (!isMissingColumnError(e)) throw e;
  }
  return out;
}
