// ═══════════════════════════════════════════════════════════════════════════
// El día de un `periodStart`/`periodEnd` de `subscription_invoices`.
//
// Vive aparte (y no dentro de `zona-horaria.ts`) por dos razones: aquel archivo
// es la zona del panel y se comparte con otras ramas tal cual, y esto de aquí
// no es una regla de zona sino de SEMÁNTICA DE COLUMNA. Se prueba solo.
// ═══════════════════════════════════════════════════════════════════════════

import { diaAdmin } from "./zona-horaria";

/**
 * `subscription_invoices.periodStart` / `.periodEnd` es una columna **MIXTA**,
 * y ahí está todo el problema: agrupar las dos clases igual mueve dinero de un
 * día a otro.
 *
 *  · **Alta MANUAL** (`/admin/payments` → `api/admin/subscriptions/route.ts`):
 *    el valor sale de un `<input type="date">` y `new Date("YYYY-MM-DD")` lo
 *    deja en **medianoche UTC exacta**. Es una FECHA DE CALENDARIO: el usuario
 *    escribió "1 de septiembre", no un instante. Pasarla a Mérida (UTC−6) la
 *    retrasaría al **31 de agosto**, siempre y en todas las filas.
 *
 *  · **Alta por STRIPE** (`lib/billing/record-stripe-invoice.ts`): el valor es
 *    `invoice.lines.data[0].period.start`, un **INSTANTE** real de corte de la
 *    suscripción, casi nunca medianoche. Ahí sí hay que fechar en la zona del
 *    panel: un corte a las 02:00 UTC es todavía la tarde del día anterior en
 *    Mérida, y en UTC se enseñaba un día adelantado.
 *
 * EL CRITERIO, explícito: **la medianoche UTC exacta se trata como fecha de
 * calendario; cualquier otra hora, como instante.** Es la única marca que
 * separa a las dos en la columna tal y como está hoy.
 *
 * Lo que este criterio NO resuelve: una factura de Stripe que cortara justo a
 * las 00:00:00.000 UTC se leería como fecha de calendario. Es poco probable
 * (Stripe corta a la hora de alta de la suscripción) y el error sería de un
 * día, el mismo que ya existe hoy: no empeora nada. La solución de fondo es
 * decidir si la columna es fecha o instante y normalizarla — es schema, y va
 * PROPUESTO en el reporte, no hecho.
 */
export function diaDePeriodo(d: Date): string {
  return esFechaDeCalendario(d) ? d.toISOString().slice(0, 10) : diaAdmin(d);
}

/** Medianoche UTC exacta: la marca de que la fila guarda una fecha, no un instante. */
export function esFechaDeCalendario(d: Date): boolean {
  return (
    d.getUTCHours() === 0 &&
    d.getUTCMinutes() === 0 &&
    d.getUTCSeconds() === 0 &&
    d.getUTCMilliseconds() === 0
  );
}
