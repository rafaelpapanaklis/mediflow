import "server-only";
// Ortodoncia — lectura de las fotos extra de los juegos (ws1-t12). SQL crudo y
// sin modelo de Prisma: las tablas nacen con
// `sql/ortodoncia-fotos-quitadas-y-extra.sql`, que pega Rafael, y el código
// tiene que funcionar antes de que existan (dev.108 usa la base real).
//
// `clinicId` SIEMPRE de la sesión, nunca del cliente.

import { prisma } from "@/lib/prisma";
import { faltaLaTablaDeFotos } from "./fotos-del-juego";

export interface ExtraCrudo {
  id: string;
  photoSetId: string;
  label: string | null;
  createdAt: Date;
  /** patient_files.url: ruta del bucket (hay que firmarla) o URL externa. */
  fileUrl: string | null;
}

/**
 * Fotos extra vigentes (no quitadas) de esos juegos, por juego. Nunca lanza:
 * sin clínica, sin tabla o con error, ninguna — la ficha se pinta igual.
 */
export async function cargarExtrasDeJuegos(
  clinicId: string,
  setIds: string[],
): Promise<Map<string, ExtraCrudo[]>> {
  const porJuego = new Map<string, ExtraCrudo[]>();
  // `clinicId: undefined` no filtra: sin clínica no se consulta nada.
  if (!clinicId || setIds.length === 0) return porJuego;
  try {
    const filas = await prisma.$queryRaw<
      { id: string; photoSetId: string; label: string | null; createdAt: Date; fileUrl: string | null }[]
    >`
      SELECT e."id", e."photoSetId", e."label", e."createdAt", f."url" AS "fileUrl"
      FROM "ortho_photo_extras" e
      JOIN "patient_files" f ON f."id" = e."fileId"
      WHERE e."clinicId" = ${clinicId}
        AND e."photoSetId" = ANY(${setIds}::text[])
        AND e."removedAt" IS NULL
      ORDER BY e."createdAt" ASC
      LIMIT 500`;
    for (const f of filas) {
      const lista = porJuego.get(f.photoSetId) ?? [];
      lista.push({ ...f, createdAt: new Date(f.createdAt) });
      porJuego.set(f.photoSetId, lista);
    }
  } catch (e) {
    if (!faltaLaTablaDeFotos(e)) console.error("[ortodoncia/fotos-extra] no se pudieron leer:", e);
  }
  return porJuego;
}
