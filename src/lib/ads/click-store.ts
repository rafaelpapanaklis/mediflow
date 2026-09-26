// Cableado a la base del guardado del clic de Ads (ver click-store-core.ts).
import { prisma } from "@/lib/prisma";
import { guardarClickAdsDeAlta, type ResultadoGuardarClick } from "./click-store-core";

/**
 * Guarda el clic de Google Ads de la petición de alta ligado a `clinicId`.
 * Se llama DESPUÉS de crear la clínica y FUERA de cualquier transacción, para
 * que un error (p. ej. tabla aún sin crear) no aborte nada. Nunca lanza.
 * Una fila por clínica: si ya había, se respeta la primera.
 */
export function guardarClickAdsDeLaAlta(
  clinicId: string,
  leerCookie: (nombre: string) => string | null | undefined,
): Promise<ResultadoGuardarClick> {
  return guardarClickAdsDeAlta(
    (f) =>
      prisma.$executeRaw`
        INSERT INTO "clinic_ads_clicks" ("clinicId", "gclid", "gbraid", "wbraid", "clickedAt", "source")
        VALUES (${f.clinicId}, ${f.gclid}, ${f.gbraid}, ${f.wbraid}, ${f.clickedAt}, ${f.source})
        ON CONFLICT ("clinicId") DO NOTHING`,
    { clinicId, leerCookie },
  );
}
