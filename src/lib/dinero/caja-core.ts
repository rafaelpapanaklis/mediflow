// ═══════════════════════════════════════════════════════════════════
// CAJA — reglas puras de ws1-t5 (F7 de la auditoría del dinero): turno que
// lleva más de un día abierto, cierre automático a medianoche y cobros en
// efectivo que no caen en ningún corte. Sin I/O: lo prueban los números.
// ═══════════════════════════════════════════════════════════════════

/** A partir de este tiempo abierta, Hoy avisa (la pantalla de Caja ya avisa desde 18 h). */
export const HORAS_AVISO_CAJA_ABIERTA = 24;

/** Días completos que lleva abierta (0 si menos de 24 h). */
export function diasAbierta(openedAt: Date | string, now: Date): number {
  const h = (now.getTime() - new Date(openedAt).getTime()) / 3_600_000;
  return h >= HORAS_AVISO_CAJA_ABIERTA ? Math.floor(h / 24) : 0;
}

/** Partes de fecha/hora de `at` en la zona `tz` (Intl, sin dependencias). */
function partes(at: Date, tz: string) {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  });
  const p = Object.fromEntries(f.formatToParts(at).map((x) => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour, mi: +p.minute, s: +p.second };
}

/**
 * La última medianoche (00:00 de la clínica) anterior o igual a `now`, como
 * instante UTC. Funciona con cualquier zona (Tijuana, Cancún…), no con UTC−6 fijo.
 */
export function medianocheAnterior(now: Date, tz: string): Date {
  const p = partes(now, tz);
  // Desfase de la zona en este instante: (hora local leída como UTC) − now.
  const comoUtc = Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s);
  const desfase = comoUtc - Math.floor(now.getTime() / 1000) * 1000;
  return new Date(Date.UTC(p.y, p.m - 1, p.d) - desfase);
}

/**
 * ¿El cierre automático debe cerrar esta caja? Sí si se abrió ANTES de la
 * última medianoche de la clínica: el turno cruzó de día. Se cierra con
 * `closedAt` = esa medianoche, así que lo cobrado después ya no es de ese turno.
 */
export function cierreAutomaticoDe(openedAt: Date, now: Date, tz: string): { cerrar: boolean; closedAt: Date } {
  const corte = medianocheAnterior(now, tz);
  return { cerrar: openedAt.getTime() < corte.getTime(), closedAt: corte };
}

export interface VentanaDeCaja { id: string; openedAt: Date; closedAt: Date | null }
export interface CobroEnEfectivo { id: string; paidAt: Date }

/**
 * Cobros en efectivo que NINGÚN corte recoge: su `paidAt` no cae dentro de la
 * ventana [openedAt, closedAt ?? now] de ninguna caja de la clínica y nadie los
 * pasó a una caja a mano. Cubre los dos casos de la auditoría: cobrado «sin
 * caja abierta» y cobrado con fecha anterior a la apertura de la caja de hoy.
 *
 * Solo desde la PRIMERA caja que la clínica abrió: una clínica que nunca usó
 * Caja no tiene «cobros fuera de corte», tiene cobros sin Caja.
 */
export function cobrosFueraDeCorte<T extends CobroEnEfectivo>(
  cobros: T[],
  cajas: VentanaDeCaja[],
  asignados: ReadonlySet<string>,
  now: Date,
  primeraApertura: Date | null,
): T[] {
  if (!primeraApertura) return [];
  const dentro = (at: Date) =>
    cajas.some((c) => at.getTime() >= c.openedAt.getTime() && at.getTime() <= (c.closedAt ?? now).getTime());
  return cobros.filter(
    (c) => c.paidAt.getTime() >= primeraApertura.getTime() && !asignados.has(c.id) && !dentro(c.paidAt),
  );
}
