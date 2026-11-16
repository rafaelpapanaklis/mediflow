import "server-only";
import { prisma } from "@/lib/prisma";
import { isMissingColumnError } from "@/lib/barber/db-errors";
import { STARS_CARD_AFTER_CHARGE_DEFAULT } from "@/lib/barber/tarjeta-cobro-core";

/* ═══════════════════════════════════════════════════════════════════════
   DaleControl BARBER — el interruptor «Mandar la tarjeta de estrellas
   después de cobrar» (ws6-t1, 16-nov). Archivo aparte y ligero: lo lee
   Configuración sin cargar el emisor de WhatsApp.

   Vive en la columna "starsCardAfterCharge" de barber_shops
   (sql/barber_tarjeta_cobro.sql), leída y escrita con SQL crudo: el schema
   de Prisma no se toca. SIN el SQL el envío está ENCENDIDO (el valor por
   defecto) y lo único que no se puede es apagarlo; la pantalla lo dice.
   ═══════════════════════════════════════════════════════════════════════ */

export interface StarsCardSetting {
  enabled: boolean;
  /** false = falta pegar sql/barber_tarjeta_cobro.sql (no se puede apagar). */
  persisted: boolean;
}

let columnMissing = false;

/** Solo para pruebas. */
export function _reiniciarTarjetaCobro() {
  columnMissing = false;
}

function requireShop(barbershopId: string): string {
  if (typeof barbershopId !== "string" || !barbershopId) throw new Error("barbershopId requerido");
  return barbershopId;
}

/** El interruptor. Nunca lanza: ante cualquier duda, el valor por defecto (encendido). */
export async function readStarsCardSetting(barbershopId: string): Promise<StarsCardSetting> {
  const shopId = requireShop(barbershopId);
  const fallback = { enabled: STARS_CARD_AFTER_CHARGE_DEFAULT, persisted: false };
  if (columnMissing) return fallback;
  try {
    const rows = await prisma.$queryRaw<Array<{ v: boolean | null }>>`
      SELECT "starsCardAfterCharge" AS "v" FROM "barber_shops" WHERE "id" = ${shopId} LIMIT 1
    `;
    const v = rows[0]?.v;
    return { enabled: typeof v === "boolean" ? v : STARS_CARD_AFTER_CHARGE_DEFAULT, persisted: true };
  } catch (e) {
    if (isMissingColumnError(e)) {
      columnMissing = true;
      return fallback;
    }
    console.warn(`[barber/tarjeta-cobro] no se pudo leer el ajuste (${shopId}):`, (e as Error).message);
    return { enabled: STARS_CARD_AFTER_CHARGE_DEFAULT, persisted: true };
  }
}

/** Guarda el interruptor. `ok: false, reason: "sql_pendiente"` si falta el SQL. */
export async function saveStarsCardSetting(
  barbershopId: string,
  enabled: boolean,
): Promise<{ ok: boolean; reason?: "sql_pendiente" | "error"; value: StarsCardSetting }> {
  const shopId = requireShop(barbershopId);
  if (typeof enabled !== "boolean") throw new Error("enabled tiene que ser sí o no");
  if (columnMissing) return { ok: false, reason: "sql_pendiente", value: await readStarsCardSetting(shopId) };
  try {
    await prisma.$executeRaw`
      UPDATE "barber_shops" SET "starsCardAfterCharge" = ${enabled} WHERE "id" = ${shopId}
    `;
    return { ok: true, value: { enabled, persisted: true } };
  } catch (e) {
    if (isMissingColumnError(e)) {
      columnMissing = true;
      return { ok: false, reason: "sql_pendiente", value: { enabled: STARS_CARD_AFTER_CHARGE_DEFAULT, persisted: false } };
    }
    console.warn(`[barber/tarjeta-cobro] no se pudo guardar el ajuste (${shopId}):`, (e as Error).message);
    return { ok: false, reason: "error", value: await readStarsCardSetting(shopId) };
  }
}
