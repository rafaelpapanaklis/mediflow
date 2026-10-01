// Origen de las clínicas para /admin (de dónde llegaron) — WS1-T10.
//
// Lee clinic_ads_clicks con SQL crudo (la tabla no tiene modelo de Prisma, ver
// click-store-core.ts) y TOLERA:
//   · que la tabla no exista (42P01)               → todas salen «Orgánico»,
//   · que falten las columnas de ws1-t10 (42703)   → se lee lo de Google de ws1-t6,
//   · cualquier otro error                         → se avisa en el log y se sigue.
// La ficha y la lista de clínicas nunca se caen por esto.
//
// /admin es la vista del dueño de la plataforma: la consulta es deliberadamente
// CROSS-TENANT (por la lista de ids que ya mostró el roster); la protege el gate
// de sesión del layout de /admin, no un filtro de tenant.

import { prisma } from "@/lib/prisma";
import { esColumnaInexistente, esTablaInexistente } from "@/lib/ads/click-store-core";
import { dtoDeOrigen, type FilaOrigenAdmin, type OrigenClinicaDTO } from "@/lib/ads/origen";

type Fila = FilaOrigenAdmin & { clinicId: string };

/** Acceso mínimo a SQL crudo (PrismaClient lo cumple; la prueba pone un falso). */
export interface RawQuery {
  $queryRaw<T = unknown>(query: TemplateStringsArray, ...values: unknown[]): Promise<T>;
}

let avisado = false;
const avisar = (msg: string) => {
  if (avisado) return;
  avisado = true;
  console.warn(`[admin/origen] ${msg}`);
};

/** Las filas de clinic_ads_clicks de esas clínicas, por clinicId. Nunca lanza. */
export async function leerFilasOrigen(db: RawQuery, ids: string[]): Promise<Map<string, Fila>> {
  const out = new Map<string, Fila>();
  const unicos = Array.from(new Set(ids.filter(Boolean)));
  if (unicos.length === 0) return out;
  let filas: Fila[] = [];
  try {
    try {
      filas = await db.$queryRaw<Fila[]>`
        SELECT "clinicId", "platform", "gclid", "gbraid", "wbraid", "fbclid", "clickedAt", "metaClickedAt", "createdAt",
               "utmSourceFirst", "utmMediumFirst", "utmCampaignFirst", "utmContentFirst", "utmFirstAt",
               "utmSourceLast", "utmMediumLast", "utmCampaignLast", "utmContentLast", "utmLastAt"
        FROM "clinic_ads_clicks"
        WHERE "clinicId" = ANY(${unicos}::text[])`;
    } catch (err) {
      if (esTablaInexistente(err) || !esColumnaInexistente(err)) throw err;
      avisar("faltan las columnas de Meta/UTM en clinic_ads_clicks: aplica sql/ws1-t10-meta-origen.sql (se muestra solo Google)");
      filas = await db.$queryRaw<Fila[]>`
        SELECT "clinicId", "gclid", "gbraid", "wbraid", "clickedAt", "createdAt"
        FROM "clinic_ads_clicks"
        WHERE "clinicId" = ANY(${unicos}::text[])`;
    }
  } catch (err) {
    if (esTablaInexistente(err)) avisar("falta la tabla clinic_ads_clicks: aplica sql/ws1-t6-ads-clics.sql y sql/ws1-t10-meta-origen.sql");
    else avisar(`no se pudo leer clinic_ads_clicks: ${(err as Error)?.message ?? err}`);
    return out;
  }
  for (const f of filas) out.set(f.clinicId, f);
  return out;
}

/** El origen de cada clínica de `ids` (las que no tienen fila salen «Orgánico»). */
export async function cargarOrigenes(ids: string[], db: RawQuery = prisma): Promise<Map<string, OrigenClinicaDTO>> {
  const filas = await leerFilasOrigen(db, ids);
  const out = new Map<string, OrigenClinicaDTO>();
  for (const id of ids) out.set(id, dtoDeOrigen(filas.get(id)));
  return out;
}

export async function cargarOrigen(clinicId: string, db: RawQuery = prisma): Promise<OrigenClinicaDTO> {
  return (await cargarOrigenes([clinicId], db)).get(clinicId) ?? dtoDeOrigen(null);
}
