// ═══════════════════════════════════════════════════════════════════
// CAJA — el aviso de «caja sin cortar», en un solo sitio.
//
// Vive aparte de lib/caja.ts porque lo usan DOS consumidores que no pueden
// cargar Prisma: la pantalla de Caja (componente de cliente) y Sabina. Antes la
// regla estaba escrita solo dentro de caja-client.tsx; si Sabina la hubiera
// copiado, bastaba con que alguien cambiara las 18 h en un lado para que la
// pantalla y Sabina dijeran cosas distintas del mismo turno.
//
// Sin imports a propósito: es aritmética de fechas y nada más.
// ═══════════════════════════════════════════════════════════════════

/** A partir de estas horas abiertas se sugiere hacer el corte (solo aviso). */
export const STALE_SHIFT_HOURS = 18;

/**
 * Clave `YYYY-MM-DD` del día natural de `at` en la zona `tz`.
 *
 * `tz` undefined = la zona del entorno (la del navegador en la pantalla). Quien
 * llama decide el fallback: la pantalla degrada a la del navegador si la zona de
 * la clínica viene rota, y Sabina a la de México, como el resto de Sabina.
 * Lanza RangeError con una zona inválida, igual que Intl.
 */
export function dayKeyIn(tz: string | undefined): (at: string | number | Date) => string {
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" });
  return (at) => {
    const parts = fmt.formatToParts(new Date(at));
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
    return `${get("year")}-${get("month")}-${get("day")}`;
  };
}

/**
 * ¿Toca avisar de que la caja lleva demasiado sin cortar?
 *
 * Sí si lleva STALE_SHIFT_HOURS o más abierta, o si cruzó a otro día natural
 * aunque lleve pocas horas (abrir a las 22:00 y seguir a la 01:00 también
 * amerita el corte). `null` = no hay aviso.
 */
export function staleShiftOf(
  openedAt: string | Date,
  nowMs: number,
  dayKey: (at: string | number | Date) => string,
): { hours: number; crossedDay: boolean } | null {
  const hours = (nowMs - new Date(openedAt).getTime()) / 3_600_000;
  const crossedDay = dayKey(openedAt) !== dayKey(nowMs);
  if (hours < STALE_SHIFT_HOURS && !crossedDay) return null;
  return { hours: Math.max(0, Math.floor(hours)), crossedDay };
}
