// ═══════════════════════════════════════════════════════════════════════
// La FILA VIRTUAL es del día. Quien se anotó ayer y nadie marcó «Se fue»
// no está esperando hoy: no cuenta en la espera de los demás, no sale en
// Inicio («3 esperando») y no le impide anotarse otra vez con su número.
// Su fila sigue en la base tal cual (no se borra ni se cambia): solo deja
// de contar como fila activa al cambiar el día en la zona de la barbería.
// ═══════════════════════════════════════════════════════════════════════
import { shopDateISO, shopLocalToUtc } from "@/lib/barber/agenda";

/** Medianoche de HOY en la zona de la barbería (instante UTC). */
export function walkInDayStart(timezone: string, now: Date = new Date()): Date {
  return shopLocalToUtc(shopDateISO(now, timezone), 0, timezone);
}

/** ¿Esta entrada es de la fila de hoy? (joinedAt desde la medianoche local). */
export function isTodaysWalkIn(joinedAt: Date, timezone: string, now: Date = new Date()): boolean {
  return joinedAt.getTime() >= walkInDayStart(timezone, now).getTime();
}
