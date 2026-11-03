// ═══════════════════════════════════════════════════════════════════════════
// El diferencial de un upgrade SIN tarjeta vale solo para el periodo y el plan
// con los que se cotizó (ola 2b, lead 6).
//
// change-plan cotiza la diferencia por los días que le QUEDAN al periodo pagado
// (`manualPaidUntil`). Un voucher OXXO o una transferencia SPEI se pagan horas o
// días después; si entre tanto la clínica compró el periodo siguiente al plan
// bajo, aplicar el plan alto le regalaba todo ese periodo (hasta un año) por la
// diferencia de unos días. Lo mismo con una sesión de tarjeta que se quedó
// abierta. Por eso el webhook compara el «pagado-hasta» de HOY con el cotizado,
// y la activación de un periodo expira las sesiones del diferencial abiertas.
// ═══════════════════════════════════════════════════════════════════════════
import type Stripe from "stripe";
import { PLAN_UPGRADE_DIFF_KIND } from "@/lib/billing/proration";

const DAY_MS = 86_400_000;

/**
 * Hasta dónde llegaba el periodo pagado que se cotizó, o null si la sesión no
 * da cómo saberlo.
 *
 *  · Sesiones nuevas: `metadata.paidUntil` (ISO), el `manualPaidUntil` exacto.
 *  · Sesiones de antes de este cambio: una cota exacta sin margen. change-plan
 *    calcula `daysRemaining = ceil((pagadoHasta − ahora) / día)` justo ANTES de
 *    crear la sesión, así que pagadoHasta ≤ creada + daysRemaining días.
 */
export function finDelPeriodoCotizado(
  metadata: Record<string, string | undefined> | null | undefined,
  creadaSeg: number | null | undefined,
): Date | null {
  const exacto = metadata?.paidUntil ? new Date(metadata.paidUntil) : null;
  if (exacto && !Number.isNaN(exacto.getTime())) return exacto;
  const dias = Number(metadata?.daysRemaining);
  if (!Number.isFinite(dias) || dias <= 0 || !creadaSeg) return null;
  return new Date(creadaSeg * 1000 + dias * DAY_MS);
}

/**
 * Expira las sesiones de Checkout del diferencial que sigan ABIERTAS para esta
 * clínica (al activarse un periodo nuevo, su cotización ya no vale). Nunca
 * lanza: el guardia de verdad es el del webhook al aplicar el pago; esto solo
 * evita que se pague algo que se va a descartar. Un voucher OXXO ya emitido o
 * una transferencia SPEI en curso no son sesiones «open» y no se tocan aquí.
 */
export async function expirarDiferencialesAbiertos(
  stripe: Stripe | null,
  customerId: string | null | undefined,
  clinicId: string,
): Promise<string[]> {
  if (!stripe || !customerId || !clinicId) return [];
  const expiradas: string[] = [];
  try {
    const abiertas = await stripe.checkout.sessions.list({ customer: customerId, status: "open", limit: 100 });
    for (const s of abiertas.data) {
      if (s.metadata?.kind !== PLAN_UPGRADE_DIFF_KIND || s.metadata?.clinicId !== clinicId) continue;
      try {
        await stripe.checkout.sessions.expire(s.id);
        expiradas.push(s.id);
      } catch (e) {
        console.error("[billing] no se pudo expirar la sesión del diferencial", s.id, e);
      }
    }
  } catch (e) {
    console.error("[billing] no se pudieron leer las sesiones abiertas del diferencial", clinicId, e);
  }
  return expiradas;
}
