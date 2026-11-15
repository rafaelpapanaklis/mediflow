// ═══════════════════════════════════════════════════════════════════════
// Hora que propone «Nueva visita» cuando no se toca ningún hueco.
//
// Antes proponía el minuto exacto de «ahora» (18:37), una hora que la
// rejilla de la agenda no tiene. Ahora es el SIGUIENTE múltiplo de la
// rejilla (BARBER_SLOT_MINUTES = 15): 18:37 → 18:45, 18:45 → 18:45.
//
// Se calcula en la hora de la barbería. Si el redondeo cruzara la
// medianoche, se queda en el último hueco del día: la fecha que se ve en el
// modal no debe saltar a mañana sin que nadie lo pida.
// ═══════════════════════════════════════════════════════════════════════
import { BARBER_SLOT_MINUTES, shopDateISO, shopMinuteOfDay } from "@/lib/barber/agenda";

export function nextSlotStart(
  now: Date,
  timezone: string,
  step: number = BARBER_SLOT_MINUTES,
): Date {
  const minute = shopMinuteOfDay(now, timezone);
  const exact = minute + now.getSeconds() / 60 + now.getMilliseconds() / 60_000;
  const rounded = Math.ceil(exact / step - 1e-9) * step;
  const next = new Date(now.getTime() - (exact - rounded) * 60_000);
  // Sin segundos sueltos.
  next.setSeconds(0, 0);
  if (shopDateISO(next, timezone) !== shopDateISO(now, timezone)) {
    const lastSlot = Math.floor((24 * 60 - 1) / step) * step;
    const fallback = new Date(now.getTime() - (exact - lastSlot) * 60_000);
    fallback.setSeconds(0, 0);
    return fallback;
  }
  return next;
}
