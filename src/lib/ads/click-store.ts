// Cableado a la base del guardado del clic de Ads (ver click-store-core.ts).
import { prisma } from "@/lib/prisma";
import { guardarClickAdsDeAlta, type FilaClick, type ResultadoGuardarClick } from "./click-store-core";

/** INSERT de WS1-T6 (solo Google): el que corre si aún faltan las columnas de ws1-t10. */
function insertarBasico(f: FilaClick) {
  return prisma.$executeRaw`
    INSERT INTO "clinic_ads_clicks" ("clinicId", "gclid", "gbraid", "wbraid", "clickedAt", "source")
    VALUES (${f.clinicId}, ${f.gclid}, ${f.gbraid}, ${f.wbraid}, ${f.clickedAt}, ${f.source})
    ON CONFLICT ("clinicId") DO NOTHING`;
}

/** INSERT completo de WS1-T10: Google + Meta (fbclid/fbc/fbp) + UTM del primer y del último toque. */
function insertarCompleto(f: FilaClick) {
  return prisma.$executeRaw`
    INSERT INTO "clinic_ads_clicks" (
      "clinicId", "gclid", "gbraid", "wbraid", "clickedAt", "source",
      "platform", "fbclid", "fbc", "fbp", "metaClickedAt",
      "utmSourceFirst", "utmMediumFirst", "utmCampaignFirst", "utmContentFirst", "utmFirstAt",
      "utmSourceLast", "utmMediumLast", "utmCampaignLast", "utmContentLast", "utmLastAt"
    ) VALUES (
      ${f.clinicId}, ${f.gclid}, ${f.gbraid}, ${f.wbraid}, ${f.clickedAt}, ${f.source},
      ${f.platform ?? null}, ${f.fbclid ?? null}, ${f.fbc ?? null}, ${f.fbp ?? null}, ${f.metaClickedAt ?? null},
      ${f.utmSourceFirst ?? null}, ${f.utmMediumFirst ?? null}, ${f.utmCampaignFirst ?? null}, ${f.utmContentFirst ?? null}, ${f.utmFirstAt ?? null},
      ${f.utmSourceLast ?? null}, ${f.utmMediumLast ?? null}, ${f.utmCampaignLast ?? null}, ${f.utmContentLast ?? null}, ${f.utmLastAt ?? null}
    )
    ON CONFLICT ("clinicId") DO NOTHING`;
}

/**
 * Guarda el clic de Google Ads, el de Meta y los UTM de la petición de alta
 * ligados a `clinicId`. Se llama DESPUÉS de crear la clínica y FUERA de
 * cualquier transacción, para que un error (p. ej. tabla aún sin crear) no
 * aborte nada. Nunca lanza. Una fila por clínica: si ya había, se respeta la primera.
 */
export function guardarClickAdsDeLaAlta(
  clinicId: string,
  leerCookie: (nombre: string) => string | null | undefined,
): Promise<ResultadoGuardarClick> {
  return guardarClickAdsDeAlta(
    (f, modo) => (modo === "completo" ? insertarCompleto(f) : insertarBasico(f)),
    { clinicId, leerCookie },
  );
}
