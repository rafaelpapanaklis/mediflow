import "server-only";
import { prisma } from "@/lib/prisma";
import { isMissingColumnError } from "@/lib/barber/db-errors";
import {
  STARS_CARD_MODE_DEFAULT,
  isStarsCardMode,
  readStarsCardMode,
  type StarsCardMode,
} from "@/lib/barber/tarjeta-cobro-core";

/* ═══════════════════════════════════════════════════════════════════════
   DaleControl BARBER — el interruptor «Mandar la tarjeta de estrellas
   después de cobrar» (ws6-t1, 16-nov). Archivo aparte y ligero: lo lee
   Configuración sin cargar el emisor de WhatsApp.

   Tres posiciones (Rafael, 16-nov): «Solo cuando sea gratis» (free, POR
   DEFECTO), «Siempre» (always) y «No mandar» (off). Vive en la columna
   "starsCardMode" de barber_shops (sql/barber_tarjeta_cobro.sql), leída y
   escrita con SQL crudo: el schema de Prisma no se toca.

   SIN el SQL vale «Solo cuando sea gratis» —que nunca genera un cobro de
   Meta— y lo único que no se puede es cambiarlo; la pantalla lo dice.
   ═══════════════════════════════════════════════════════════════════════ */

export interface StarsCardSetting {
  mode: StarsCardMode;
  /** false = falta pegar sql/barber_tarjeta_cobro.sql (no se puede cambiar). */
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

/** El interruptor. Nunca lanza: ante cualquier duda, «Solo cuando sea gratis». */
export async function readStarsCardSetting(barbershopId: string): Promise<StarsCardSetting> {
  const shopId = requireShop(barbershopId);
  const fallback = { mode: STARS_CARD_MODE_DEFAULT, persisted: false };
  if (columnMissing) return fallback;
  try {
    const rows = await prisma.$queryRaw<Array<{ v: string | null }>>`
      SELECT "starsCardMode" AS "v" FROM "barber_shops" WHERE "id" = ${shopId} LIMIT 1
    `;
    return { mode: readStarsCardMode(rows[0]?.v), persisted: true };
  } catch (e) {
    if (isMissingColumnError(e)) {
      columnMissing = true;
      return fallback;
    }
    console.warn(`[barber/tarjeta-cobro] no se pudo leer el ajuste (${shopId}):`, (e as Error).message);
    return { mode: STARS_CARD_MODE_DEFAULT, persisted: true };
  }
}

/** Guarda el interruptor. `ok: false, reason: "sql_pendiente"` si falta el SQL. */
export async function saveStarsCardSetting(
  barbershopId: string,
  mode: unknown,
): Promise<{ ok: boolean; reason?: "sql_pendiente" | "error"; value: StarsCardSetting }> {
  const shopId = requireShop(barbershopId);
  if (!isStarsCardMode(mode)) throw new Error("El modo tiene que ser «free», «always» u «off».");
  if (columnMissing) return { ok: false, reason: "sql_pendiente", value: await readStarsCardSetting(shopId) };
  try {
    await prisma.$executeRaw`
      UPDATE "barber_shops" SET "starsCardMode" = ${mode} WHERE "id" = ${shopId}
    `;
    return { ok: true, value: { mode, persisted: true } };
  } catch (e) {
    if (isMissingColumnError(e)) {
      columnMissing = true;
      return { ok: false, reason: "sql_pendiente", value: { mode: STARS_CARD_MODE_DEFAULT, persisted: false } };
    }
    console.warn(`[barber/tarjeta-cobro] no se pudo guardar el ajuste (${shopId}):`, (e as Error).message);
    return { ok: false, reason: "error", value: await readStarsCardSetting(shopId) };
  }
}
