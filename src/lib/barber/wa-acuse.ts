import "server-only";
import { prisma } from "@/lib/prisma";
import { isMissingTableError } from "@/lib/barber/db-errors";
import {
  DEFAULT_BARBER_WA_ACK_SETTINGS,
  normalizeBarberWaAckSettings,
  type BarberWaAckSettings,
} from "@/lib/barber/wa-acuse-core";

/* ═══════════════════════════════════════════════════════════════════════
   DaleControl BARBER — el ajuste del ACUSE AUTOMÁTICO (lectura y guardado).

   Vive en la tabla `barber_wa_acuse` (sql/barber_wa_acuse.sql), una fila por
   barbería. Se lee y escribe con SQL crudo, igual que nacieron las demás
   tablas del vertical: así no hay que regenerar el cliente de Prisma y el
   código funciona ANTES de que se pegue el SQL — sin la tabla, el acuse
   está apagado (el default) y la pantalla lo dice.

   El barbershopId SIEMPRE llega del servidor (la sesión, o la barbería
   dueña del número en el webhook). Nunca del navegador.
   ═══════════════════════════════════════════════════════════════════════ */

export class BarberWaAckStorageError extends Error {
  constructor() {
    super("Falta aplicar sql/barber_wa_acuse.sql en la base de datos para poder guardar este ajuste.");
    this.name = "BarberWaAckStorageError";
  }
}

export interface BarberWaAckState {
  settings: BarberWaAckSettings;
  /** false = la tabla todavía no existe en esta base. */
  storageReady: boolean;
}

function requireShop(barbershopId: string): string {
  if (typeof barbershopId !== "string" || !barbershopId) {
    // Sin barbería no se consulta: un filtro vacío leería la de cualquiera.
    throw new Error("barbershopId requerido");
  }
  return barbershopId;
}

/** El ajuste de UNA barbería. Nunca lanza: ante cualquier fallo, apagado. */
export async function getBarberWaAck(barbershopId: string): Promise<BarberWaAckState> {
  const shopId = requireShop(barbershopId);
  try {
    const rows = await prisma.$queryRaw<Array<{ enabled: boolean; message: string | null }>>`
      SELECT "enabled", "message" FROM "barber_wa_acuse" WHERE "barbershopId" = ${shopId} LIMIT 1
    `;
    return { settings: normalizeBarberWaAckSettings(rows[0] ?? null), storageReady: true };
  } catch (err) {
    if (!isMissingTableError(err)) {
      console.warn(`[barber/wa-acuse] no se pudo leer el ajuste (${shopId}):`, err);
      return { settings: { ...DEFAULT_BARBER_WA_ACK_SETTINGS }, storageReady: true };
    }
    return { settings: { ...DEFAULT_BARBER_WA_ACK_SETTINGS }, storageReady: false };
  }
}

/** Guarda el ajuste. Lanza BarberWaAckStorageError si falta el SQL. */
export async function saveBarberWaAck(barbershopId: string, raw: unknown): Promise<BarberWaAckSettings> {
  const shopId = requireShop(barbershopId);
  const settings = normalizeBarberWaAckSettings(raw);
  try {
    await prisma.$executeRaw`
      INSERT INTO "barber_wa_acuse" ("barbershopId", "enabled", "message", "updatedAt")
      VALUES (${shopId}, ${settings.enabled}, ${settings.message}, CURRENT_TIMESTAMP)
      ON CONFLICT ("barbershopId") DO UPDATE
        SET "enabled" = EXCLUDED."enabled",
            "message" = EXCLUDED."message",
            "updatedAt" = CURRENT_TIMESTAMP
    `;
  } catch (err) {
    if (isMissingTableError(err)) throw new BarberWaAckStorageError();
    throw err;
  }
  return settings;
}
