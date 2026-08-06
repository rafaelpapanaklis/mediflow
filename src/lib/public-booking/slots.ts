import { tzLocalToUtc } from "@/lib/agenda/time-utils";

/**
 * Cálculo de huecos por SOLAPE para la reserva pública (P1-10).
 *
 * Antes /api/public/availability marcaba ocupado un slot solo si una cita
 * EMPEZABA exactamente a esa hora: una cita de 10:00–11:00 dejaba "10:30"
 * como disponible, el público la elegía y el INSERT moría contra la
 * constraint EXCLUDE (appt_doctor_no_overlap) con un 500 crudo.
 *
 * Semántica de "ocupado" idéntica a la constraint y al bot de WhatsApp:
 * intervalos [start, end) que se tocan, ignorando citas CANCELLED/NO_SHOW
 * y las que tienen overrideReason (esas tampoco bloquean el INSERT en
 * Postgres). El caller arma `busy` con ese filtro; aquí solo se compara.
 */
export interface BusyInterval {
  startsAt: Date;
  endsAt: Date;
}

/** true si [slotStartUtc, slotStartUtc + durationMin) se solapa con algún ocupado. */
export function slotOverlapsBusy(
  slotStartUtc: Date,
  durationMin: number,
  busy: BusyInterval[],
): boolean {
  const startMs = slotStartUtc.getTime();
  const endMs = startMs + durationMin * 60_000;
  return busy.some(
    (b) => b.startsAt.getTime() < endMs && b.endsAt.getTime() > startMs,
  );
}

/**
 * Parte la lista de slots "HH:MM" de un día (en la tz de la clínica) entre
 * disponibles y tomados, comparando por solape contra las citas ocupadas.
 */
export function partitionSlotsByOverlap(
  slots: string[],
  dateISO: string,
  timezone: string,
  durationMin: number,
  busy: BusyInterval[],
): { available: string[]; taken: string[] } {
  const available: string[] = [];
  const taken: string[] = [];
  for (const hhmm of slots) {
    const [h, mn] = hhmm.split(":").map(Number);
    const slotStart = tzLocalToUtc(dateISO, h, mn, timezone);
    if (slotOverlapsBusy(slotStart, durationMin, busy)) taken.push(hhmm);
    else available.push(hhmm);
  }
  return { available, taken };
}
