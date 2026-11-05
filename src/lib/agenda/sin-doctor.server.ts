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

/**
 * ws1-t11 (D9) — el cierre que no pasa por /status ni /complete (firmar la hoja de control de
 * ortodoncia): si la cita sigue «Sin doctor», queda a nombre de quien la atendió. Condicional
 * (`doctorId: null`): nunca pisa un doctor ya puesto. Nunca lanza: si ese doctor ya tiene otra
 * cita a esa hora (la constraint), la cita se queda «Sin doctor» y la firma sigue en pie.
 */
export async function asignarSiSinDoctor(
  db: { appointment: { updateMany(args: any): Promise<{ count: number }> } },
  args: { clinicId: string; appointmentId: string; doctorId: string | null | undefined },
): Promise<boolean> {
  if (!args.clinicId || !args.appointmentId || !args.doctorId) return false;
  try {
    const r = await db.appointment.updateMany({
      where: { id: args.appointmentId, clinicId: args.clinicId, doctorId: null },
      data: { doctorId: args.doctorId },
    });
    return r.count > 0;
  } catch (e) {
    console.warn("[cita-sin-doctor] no se pudo asignar el doctor al cerrar:", e);
    return false;
  }
}

/** Solo pruebas. */
export function _olvidarSinDoctor(): void {
  fijar(undefined);
}
