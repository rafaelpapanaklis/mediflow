// C-114 (ws1-t8): la columna `clinics."reservaWebAbierta"` llega con
// sql/ws1-t8-reserva-web.sql, que pega Rafael. NO está en schema.prisma (el
// cliente de Prisma se comparte con dev.108 y con el campo en el modelo toda
// lectura de Clinic sin `select` reventaría con P2022 hasta pegar el SQL).
// Va por SQL crudo detrás de una sonda a information_schema (nunca falla)
// recordada en globalThis. Sin columna: la reserva está ABIERTA, como hoy, y
// no se lanza ninguna consulta que la nombre.

import { prisma } from "@/lib/prisma";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

const SONDA = Symbol.for("dalecontrol.clinics.reservaWebAbierta");
type Sonda = { existe: boolean; at: number };
const RE_PREGUNTAR_MS = 10 * 60_000;

/** ¿Existe la columna? Si la sonda falla, `false` sin recordarlo. */
export async function hayColumnaReservaWeb(db: Db = prisma): Promise<boolean> {
  const g = globalThis as unknown as Record<symbol, Sonda | undefined>;
  const s = g[SONDA];
  if (s && (s.existe || Date.now() - s.at < RE_PREGUNTAR_MS)) return s.existe;
  try {
    const filas = await db.$queryRaw`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'clinics' AND column_name = 'reservaWebAbierta'
      ) AS existe`;
    const existe = (filas as Array<{ existe: boolean }>)?.[0]?.existe === true;
    g[SONDA] = { existe, at: Date.now() };
    return existe;
  } catch {
    return false;
  }
}

/** Solo para las pruebas. */
export function olvidarSondaReservaWeb(): void {
  delete (globalThis as unknown as Record<symbol, unknown>)[SONDA];
}

/** ¿Recibe reservas en línea? Sin columna, o si la lectura falla: sí (como hoy). */
export async function reservaWebAbierta(clinicId: string, db: Db = prisma): Promise<boolean> {
  if (!clinicId) return true;
  if (!(await hayColumnaReservaWeb(db))) return true;
  try {
    const filas = (await db.$queryRaw`
      SELECT "reservaWebAbierta" AS abierta FROM "clinics" WHERE "id" = ${clinicId}`) as Array<{ abierta: boolean | null }>;
    return filas?.[0]?.abierta !== false;
  } catch (e) {
    console.warn("[reserva-web] no se pudo leer el estado:", e);
    return true;
  }
}

/** Guarda el estado. Devuelve false si la columna aún no existe (no se guardó). */
export async function guardarReservaWebAbierta(clinicId: string, abierta: boolean, db: Db = prisma): Promise<boolean> {
  if (!clinicId) throw new Error("sesion_invalida: falta clinicId");
  if (!(await hayColumnaReservaWeb(db))) return false;
  await db.$executeRaw`UPDATE "clinics" SET "reservaWebAbierta" = ${abierta} WHERE "id" = ${clinicId}`;
  return true;
}
