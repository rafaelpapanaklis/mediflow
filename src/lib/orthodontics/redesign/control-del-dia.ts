// Orthodontics — Control y agenda, Ola 3 (ws1-t8, Ronda 6, «El día de la
// ortodoncista»). M6 del bloque: "UNA sola forma de registrar el control...
// no dos controles el mismo día" (hallazgo 7 de REPORTE-ws1-t4.md).
//
// Antes, "¿ya hay hoja de hoy?" solo se resolvía por `appointmentId` exacto
// (getTreatmentCardContextForAppointment.ts): dos aperturas de "Registrar
// control" el mismo día por caminos distintos (Agenda vs. ficha, o dos citas
// de control el mismo día por error de recepción) podían crear DOS hojas del
// mismo caso el mismo día — el número de control y el mes de tratamiento se
// desfasaban. Esta función es la ÚNICA fuente de "¿cuál es la hoja de hoy de
// este caso?", por fecha de calendario en la zona de la CLÍNICA (no UTC ni la
// del navegador) — la usan getTreatmentCardContextForAppointment.ts Y
// getTreatmentCardContextForPatient.ts, para que Agenda y ficha respondan lo
// mismo.

import { hoyEnZona } from "@/lib/whatsapp/cobranza/sweep";
import { calendarDayRangeUtc } from "@/lib/agenda/time-utils";

/**
 * De una lista de hojas de control (cualquier estado, del mismo plan de
 * tratamiento), la que corresponde al día de calendario de HOY en la zona de
 * la clínica — si hay varias, la más reciente. `null` si ninguna es de hoy.
 */
export function tarjetaDeControlDeHoy<T extends { visitDate: Date }>(
  cards: readonly T[],
  timezone: string,
  ahora: Date = new Date(),
): T | null {
  if (cards.length === 0) return null;
  const { startUtc, endUtc } = calendarDayRangeUtc(hoyEnZona(ahora, timezone), timezone);
  const deHoy = cards.filter((c) => c.visitDate >= startUtc && c.visitDate < endUtc);
  if (deHoy.length === 0) return null;
  return deHoy.reduce((last, c) => (c.visitDate > last.visitDate ? c : last));
}
