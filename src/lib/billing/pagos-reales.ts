import type { Prisma } from "@prisma/client";
import { METODO_ACTIVACION_ADMIN } from "@/lib/billing/cobro-rechazado";

/**
 * PAGOS REALES de `subscription_invoices` (ws1-t1).
 *
 * La activación manual de /admin (`activate_clinic`) deja una fila pagada de $0 con `method = "admin"` para que el
 * webhook de Stripe sepa que la clínica ya está cubierta (ver `pagoManualCubre`). Esa fila NO es un cobro: una
 * activación de cortesía no puede disparar una comisión de afiliado, contar como «primer pago» o «clínica que
 * paga», ni inflar un conteo o KPI. Por eso TODO sitio que cuenta o suma filas de esa tabla pasa por este módulo:
 *
 *   · `sinActivacionManual(where)`            → el `where` de Prisma (count, groupBy, aggregate, findMany).
 *   · `sqlSinActivacionManual(alias)`          → el mismo criterio para SQL crudo.
 *   · `esActivacionManual(fila)`               → para filas ya leídas (rotular en pantalla, filtrar un arreglo).
 *
 * El único que SÍ las lee es el webhook (`pagoManualCubre`): es justo su razón de ser. Las listas del /admin las
 * enseñan, rotuladas «Activación manual (sin cobro)», nunca como «Pagado». El test `pagos-reales.test.ts` falla si
 * aparece una consulta nueva que cuenta o suma pagos sin pasar por aquí.
 *
 * La promo del primer mes (`isFirstContract`) no lee esta tabla (mira la suscripción y `nextBillingDate` de la
 * clínica), así que la fila no la gana ni la pierde.
 */

export const ROTULO_ACTIVACION_MANUAL = "Activación manual (sin cobro)";

/** Prefijo de `reference` del rastro que deja el SPEI/OXXO de Stripe (pago único acreditado por webhook). */
export const PREFIJO_REFERENCIA_PAGO_UNICO_STRIPE = "pago-unico:";
export const ROTULO_PAGO_UNICO_STRIPE = "Pago SPEI/OXXO por Stripe (rastro)";

/** El rastro de $0 de un SPEI/OXXO cobrado por Stripe (no es una activación del admin aunque comparta método). */
export function esRastroDePagoUnicoStripe(fila: { reference?: string | null } | null | undefined): boolean {
  return !!fila && typeof fila.reference === "string" && fila.reference.startsWith(PREFIJO_REFERENCIA_PAGO_UNICO_STRIPE);
}

/**
 * El rótulo de una fila de $0 que NO es un cobro, o null si es un pago normal: «Activación manual (sin cobro)» para la
 * del admin y «Pago SPEI/OXXO por Stripe (rastro)» para la del pago único de Stripe (el cobro real vive en Stripe).
 */
export function rotuloDeFilaSinCobro(
  fila: { method?: string | null; amount?: number | null; reference?: string | null } | null | undefined,
): string | null {
  if (!esActivacionManual(fila)) return null;
  return esRastroDePagoUnicoStripe(fila) ? ROTULO_PAGO_UNICO_STRIPE : ROTULO_ACTIVACION_MANUAL;
}

/** Una fila de $0 con método «admin». */
export function esActivacionManual(fila: { method?: string | null; amount?: number | null } | null | undefined): boolean {
  return !!fila && fila.method === METODO_ACTIVACION_ADMIN && (fila.amount ?? 0) === 0;
}

/** Filas que NO son activación manual (las nulas en `method` cuentan: son pagos sin método capturado). */
export const FILTRO_SIN_ACTIVACION_MANUAL: Prisma.SubscriptionInvoiceWhereInput = {
  OR: [{ method: null }, { method: { not: METODO_ACTIVACION_ADMIN } }, { amount: { not: 0 } }],
};

/** `where` + «no es una activación manual». Se compone con AND, así no pisa un `OR`/`AND` que ya traiga el `where`. */
export function sinActivacionManual(where: Prisma.SubscriptionInvoiceWhereInput = {}): Prisma.SubscriptionInvoiceWhereInput {
  return { AND: [where, FILTRO_SIN_ACTIVACION_MANUAL] };
}

/** Lo mismo para SQL crudo (`alias` = el de la tabla en el FROM). NULL en `method` cuenta como pago. */
export function sqlSinActivacionManual(alias = "s"): string {
  return `(${alias}.method IS DISTINCT FROM '${METODO_ACTIVACION_ADMIN}' OR ${alias}.amount <> 0)`;
}

/** Quita las activaciones manuales de un arreglo ya leído. */
export function sinFilasDeActivacionManual<T extends { method?: string | null; amount?: number | null }>(filas: T[]): T[] {
  return filas.filter((f) => !esActivacionManual(f));
}
