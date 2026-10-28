// El estado de cada marca del odontograma en la base (ws1-t6): la columna
// `odontogram_entries."estado"` (sql/odontograma-estado-marca.sql), su sonda, su lectura y su
// escritura. SQL crudo: el esquema de Prisma no la conoce (y no debe: con el campo en el modelo,
// toda lectura de `odontogramEntry` reventaría hasta que se pegue el SQL).
//
// Sin la columna, todo funciona como hoy: no se lee ni se escribe estado y la pantalla no enseña el
// selector «Por hacer / Realizado».

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { esEstadoMarca, type EstadoMarca } from "./estado-marca";

type Db = Pick<Prisma.TransactionClient, "$queryRaw" | "$executeRaw">;

// ── La columna (sonda en globalThis: sobrevive a las recargas de `next dev`) ────────────────────

const REPREGUNTAR_MS = 2 * 60_000;
const CLAVE = Symbol.for("dalecontrol.odontogram.estado-marca");
type Sonda = { existe: boolean; en: number };

function memoria(): { columna?: Sonda } {
  const g = globalThis as unknown as Record<symbol, { columna?: Sonda } | undefined>;
  if (!g[CLAVE]) g[CLAVE] = {};
  return g[CLAVE]!;
}

/** Solo para las pruebas. */
export function _olvidarSondaEstado(): void {
  delete memoria().columna;
}

/**
 * ¿Está `odontogram_entries."estado"`? Un «sí» se recuerda; un «no» se vuelve a preguntar a los 2 min.
 * `estricta` (lo que propone cobros): no se fía de un «no» recordado y, si no se puede saber, LANZA en
 * vez de contestar «no» — sin estados, una marca roja parecería trabajo hecho y se propondría cobrarla.
 */
export async function columnaEstadoExiste(opciones: { estricta?: boolean } = {}): Promise<boolean> {
  const m = memoria();
  if (m.columna?.existe) return true;
  if (!opciones.estricta && m.columna && Date.now() - m.columna.en < REPREGUNTAR_MS) return false;
  try {
    const r = await prisma.$queryRaw<{ existe: boolean }[]>`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'odontogram_entries' AND column_name = 'estado'
      ) AS existe`;
    const existe = r[0]?.existe === true;
    m.columna = { existe, en: Date.now() };
    return existe;
  } catch (e) {
    if (opciones.estricta) throw e;
    console.warn("[odontograma] no se pudo saber si existe la columna estado:", e);
    return false;
  }
}

// ── Lectura y escritura ─────────────────────────────────────────────────────────────────────────

/** id de la entrada → estado, solo las que lo tienen (lo viejo, sin estado, no viaja). */
export async function leerEstados(db: Db, patientId: string): Promise<Map<string, EstadoMarca>> {
  const filas = await db.$queryRaw<{ id: string; estado: string | null }[]>`
    SELECT "id", "estado" FROM "odontogram_entries"
     WHERE "patientId" = ${patientId} AND "estado" IS NOT NULL`;
  const out = new Map<string, EstadoMarca>();
  for (const f of filas) if (esEstadoMarca(f.estado)) out.set(f.id, f.estado);
  return out;
}

/** Fija el estado de UNA entrada del paciente (por id). */
export async function fijarEstado(db: Db, patientId: string, id: string, estado: EstadoMarca | null): Promise<void> {
  await db.$executeRaw`
    UPDATE "odontogram_entries" SET "estado" = ${estado}, "updatedAt" = now()
     WHERE "id" = ${id} AND "patientId" = ${patientId}`;
}

/** Fija el estado de una marca por su lugar (diente, cara, condición); `surface` null = diente completo. */
export async function fijarEstadoPorLugar(
  db: Db,
  lugar: { patientId: string; toothNumber: number; surface: string | null; conditionId: string },
  estado: EstadoMarca | null,
): Promise<void> {
  if (lugar.surface === null) {
    await db.$executeRaw`
      UPDATE "odontogram_entries" SET "estado" = ${estado}, "updatedAt" = now()
       WHERE "patientId" = ${lugar.patientId} AND "toothNumber" = ${lugar.toothNumber}::int
         AND "surface" IS NULL AND "conditionId" = ${lugar.conditionId}`;
    return;
  }
  await db.$executeRaw`
    UPDATE "odontogram_entries" SET "estado" = ${estado}, "updatedAt" = now()
     WHERE "patientId" = ${lugar.patientId} AND "toothNumber" = ${lugar.toothNumber}::int
       AND "surface" = ${lugar.surface} AND "conditionId" = ${lugar.conditionId}`;
}
