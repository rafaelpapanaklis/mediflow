// ID EXTERNOS de la importación: de qué sistema y con qué ID llegó cada paciente
// o saldo. Vive en la tabla import_external_ids (sql/import-ids-externos.sql),
// que NO está en schema.prisma: se usa por SQL directo, así el cliente de Prisma
// no cambia y el código tolera que el SQL aún no se haya aplicado (devuelve
// vacío y avisa; la importación sigue con la deduplicación de siempre).
//
// Aislamiento: TODA consulta lleva clinicId (viene de la sesión, ver runImport).

import { prisma } from "@/lib/prisma";
import { newId } from "./migrado";

export type EntidadExterna = "patient" | "balance" | "payment" | "labExpense" | "installment" | "procedure";

/** Tope por sentencia: el JSON de un lote de 200 filas cabe de sobra. */
const LOTE = 500;

/** ¿El error es «la tabla import_external_ids no existe»? (SQL pendiente) */
export function faltaLaTabla(e: unknown): boolean {
  const msg = String((e as any)?.message ?? "");
  const code = (e as any)?.code ?? (e as any)?.meta?.code;
  return /import_external_ids/.test(msg) && (code === "42P01" || /does not exist|no existe/i.test(msg));
}

export interface ExternosCargados {
  /** externalId → localId. */
  mapa: Map<string, string>;
  /** false = la tabla no existe todavía (SQL pendiente). */
  disponible: boolean;
}

export async function cargarExternos(clinicId: string, source: string, entity: EntidadExterna): Promise<ExternosCargados> {
  if (typeof clinicId !== "string" || !clinicId) throw new Error("cargarExternos: falta clinicId");
  try {
    const rows = await prisma.$queryRaw<{ externalId: string; localId: string }[]>`
      SELECT "externalId", "localId"
      FROM "import_external_ids"
      WHERE "clinicId" = ${clinicId} AND "source" = ${source} AND "entity" = ${entity}`;
    return { mapa: new Map(rows.map((r) => [r.externalId, r.localId])), disponible: true };
  } catch (e) {
    if (faltaLaTabla(e)) return { mapa: new Map(), disponible: false };
    throw e;
  }
}

/**
 * Guarda pares externalId → localId. Los que ya existían se respetan (ON
 * CONFLICT DO NOTHING). Devuelve false si la tabla no existe; nunca lanza por eso:
 * los datos ya se importaron, solo falta el recuerdo.
 */
export async function guardarExternos(
  clinicId: string,
  source: string,
  entity: EntidadExterna,
  pares: Array<{ externalId: string; localId: string }>,
): Promise<boolean> {
  if (typeof clinicId !== "string" || !clinicId) throw new Error("guardarExternos: falta clinicId");
  try {
    for (let i = 0; i < pares.length; i += LOTE) {
      const json = JSON.stringify(pares.slice(i, i + LOTE).map((p) => ({ id: newId(), ext: p.externalId, loc: p.localId })));
      await prisma.$executeRaw`
        INSERT INTO "import_external_ids" ("id", "clinicId", "source", "entity", "externalId", "localId")
        SELECT x.id, ${clinicId}, ${source}, ${entity}, x.ext, x.loc
        FROM jsonb_to_recordset(${json}::jsonb) AS x(id text, ext text, loc text)
        ON CONFLICT ("clinicId", "source", "entity", "externalId") DO NOTHING`;
    }
    return true;
  } catch (e) {
    if (faltaLaTabla(e)) return false;
    throw e;
  }
}

/** Un ID de una celda: texto recortado, sin «.0» de los números de Excel, o "" si no hay. */
export function limpiarId(v: unknown): string {
  if (v === undefined || v === null) return "";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "";
  return String(v).trim().replace(/^(\d+)\.0+$/, "$1").slice(0, 120);
}
