/**
 * La fecha de un cobro: de lo que se elige en el modal al instante que se
 * guarda. Puro y sin React a propósito — el modal es "use client" y esto se
 * prueba con `npm run test:paid-at`.
 *
 * EL FALLO QUE ARREGLA. El modal de cobro (`payment-modal.tsx`) hacía dos
 * cuentas distintas sobre la misma idea de "hoy", y ninguna de las dos era la
 * del usuario:
 *
 *   1. El valor por defecto y el `max` del campo salían de
 *      `new Date().toISOString().slice(0,10)`, que es la fecha en **UTC**. El
 *      calendario de `DateField`, en cambio, marca "hoy" con las partes
 *      **locales** (`getFullYear/getMonth/getDate`). En México (UTC−6) las dos
 *      dejan de coincidir todas las tardes a partir de las 18:00: el campo
 *      escribía ya MAÑANA mientras el calendario seguía marcando HOY — y el
 *      `max`, que existe para que no se feche un cobro a futuro, dejaba pasar
 *      justamente el día siguiente.
 *
 *   2. Al enviar, `new Date("2026-09-07")` se interpreta como **medianoche
 *      UTC**, que en México son las **18:00 del día ANTERIOR**. Así que el
 *      cobro se guardaba seis horas antes de empezar el día que el usuario
 *      había elegido: caía en el bucket del día anterior de la gráfica de
 *      ingresos (`lib/home/revenue-buckets.ts` agrupa `paidAt` por la zona de
 *      la clínica) y quedaba fuera del turno de caja abierto. Es el desfase que
 *      `api/invoices/[id]/route.ts` describe en `cashOutsideRegisterWarning`:
 *      por él, ese aviso NO puede comparar `paidAt` contra `openedAt` —
 *      marcaría casi todos los cobros del día y dejaría de significar nada.
 *
 * LA REGLA DE AQUÍ. El día lo pone el usuario; la hora la pone el caso:
 *
 *   · Si el día elegido es HOY, se guarda el instante REAL del cobro (`now`).
 *     Es la verdad —el pago se está registrando ahora— y además cae dentro del
 *     turno de caja abierto, que es lo que hace cuadrar el arqueo.
 *   · Si es un día pasado (back-date, que el endpoint permite a propósito), se
 *     ancla a las **12:00 locales** de ese día. El mediodía deja ±12 h de
 *     margen antes de que el día cambie en la zona de la clínica; la medianoche
 *     no deja ninguno, y es exactamente de donde venía el fallo.
 *
 * No se usa la zona de la CLÍNICA porque el modal no la recibe: llega desde dos
 * pantallas (`dashboard/billing` y la ficha del paciente) que hoy no la pasan.
 * La del navegador es la del mostrador donde se cobra, y el ancla de mediodía
 * absorbe la diferencia si algún día no coinciden. Queda anotado en el reporte.
 */

const pad2 = (n: number) => String(n).padStart(2, "0");

/** Hoy en la zona del NAVEGADOR, en `yyyy-mm-dd`. La misma cuenta que hace
 *  `DateField` para marcar el día de hoy en el calendario. */
export function todayLocalISO(now: Date = new Date()): string {
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
}

/** Partes de un `yyyy-mm-dd`, o null si no lo es. */
function parseDateISO(value: string): { y: number; m: number; d: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  // Rebote de fecha imposible (31 de febrero): el Date local se sale del mes.
  const probe = new Date(y, mo - 1, d, 12, 0, 0, 0);
  if (probe.getFullYear() !== y || probe.getMonth() !== mo - 1 || probe.getDate() !== d) return null;
  return { y, m: mo, d };
}

/**
 * El `paidAt` que se manda al endpoint para el día elegido en el campo.
 *
 * Devuelve `undefined` cuando no hay fecha válida: el endpoint deja entonces su
 * `default(now())`, que es justo lo que se quiere, en vez de guardar una fecha
 * inventada.
 */
export function paidAtInstant(dateISO: string, now: Date = new Date()): Date | undefined {
  if (!dateISO) return undefined;
  const parts = parseDateISO(dateISO);
  if (!parts) return undefined;
  // Hoy → el instante real del cobro (y dentro del turno de caja abierto).
  if (dateISO === todayLocalISO(now)) return now;
  // Cualquier otro día → mediodía local de ESE día.
  return new Date(parts.y, parts.m - 1, parts.d, 12, 0, 0, 0);
}
