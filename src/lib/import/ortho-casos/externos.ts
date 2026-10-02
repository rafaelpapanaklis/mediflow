// ID EXTERNOS para CASOS DE ORTODONCIA MIGRADOS (ws1-t1).
//
// Copia deliberada (no import) de src/lib/import/externos.ts: ese archivo
// declara `EntidadExterna` como una unión CERRADA de literales ("patient" |
// "balance" | "payment"…) que otras pantallas de esta misma ola están
// extendiendo en paralelo (labExpense…) — añadir "orthoCase" ahí pisaría su
// misma línea. Mismo criterio ya usado por pagos-historial/paciente.ts para
// no tocar entities.ts mientras ws1-t12 lo cambia. Usa la MISMA tabla
// `import_external_ids` (sql/import-ids-externos.sql): el valor "orthoCase"
// en la columna "entity" es texto libre en SQL, así que convivir con la
// unión de externos.ts no requiere que ambos archivos compartan el tipo.
//
// Aislamiento: TODA consulta lleva clinicId (viene de la sesión, ver runImport).

import { prisma } from "@/lib/prisma";
import { newId } from "../migrado";

const ENTITY = "orthoCase" as const;

/** ¿El error es «la tabla import_external_ids no existe»? (SQL pendiente) */
function faltaLaTablaExternos(e: unknown): boolean {
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

export async function cargarExternosOrthoCase(clinicId: string, source: string): Promise<ExternosCargados> {
  if (typeof clinicId !== "string" || !clinicId) throw new Error("cargarExternosOrthoCase: falta clinicId");
  try {
    const rows = await prisma.$queryRaw<{ externalId: string; localId: string }[]>`
      SELECT "externalId", "localId"
      FROM "import_external_ids"
      WHERE "clinicId" = ${clinicId} AND "source" = ${source} AND "entity" = ${ENTITY}`;
    return { mapa: new Map(rows.map((r) => [r.externalId, r.localId])), disponible: true };
  } catch (e) {
    if (faltaLaTablaExternos(e)) return { mapa: new Map(), disponible: false };
    throw e;
  }
}

const LOTE = 500;

/**
 * Guarda pares externalId → localId. Los que ya existían se respetan (ON
 * CONFLICT DO NOTHING). Devuelve false si la tabla no existe; nunca lanza por eso.
 */
export async function guardarExternosOrthoCase(
  clinicId: string,
  source: string,
  pares: Array<{ externalId: string; localId: string }>,
): Promise<boolean> {
  if (typeof clinicId !== "string" || !clinicId) throw new Error("guardarExternosOrthoCase: falta clinicId");
  try {
    for (let i = 0; i < pares.length; i += LOTE) {
      const json = JSON.stringify(pares.slice(i, i + LOTE).map((p) => ({ id: newId("import_external_ids"), ext: p.externalId, loc: p.localId })));
      await prisma.$executeRaw`
        INSERT INTO "import_external_ids" ("id", "clinicId", "source", "entity", "externalId", "localId")
        SELECT x.id, ${clinicId}, ${source}, ${ENTITY}, x.ext, x.loc
        FROM jsonb_to_recordset(${json}::jsonb) AS x(id text, ext text, loc text)
        ON CONFLICT ("clinicId", "source", "entity", "externalId") DO NOTHING`;
    }
    return true;
  } catch (e) {
    if (faltaLaTablaExternos(e)) return false;
    throw e;
  }
}

/** Un ID de una celda: texto recortado, sin «.0» de los números de Excel, o "" si no hay. */
export function limpiarId(v: unknown): string {
  if (v === undefined || v === null) return "";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "";
  return String(v).trim().replace(/^(\d+)\.0+$/, "$1").slice(0, 120);
}
