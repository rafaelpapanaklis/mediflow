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
