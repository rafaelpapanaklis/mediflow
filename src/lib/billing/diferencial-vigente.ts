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
import type { AvisoAdmin } from "@/lib/billing/avisos-admin";
import { prisma } from "@/lib/prisma";

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
 *
 * `pagadoHasta` = el «pagado hasta» de la clínica YA escrita. Solo se expira lo
 * que el webhook descartaría después (revisión t8 de la unión, m1): una sesión
 * cotizada sobre el periodo VIGENTE (`metadata.paidUntil` ≥ pagadoHasta, la
 * condición de `period-changed` al revés) se deja abierta. Si no, una reentrega
 * tardía de la activación le tumbaba a la clínica el cambio de plan que acababa
 * de abrir. Sin `metadata.paidUntil` (sesiones de antes) o sin `pagadoHasta`,
 * se expiran como siempre.
 */
export async function expirarDiferencialesAbiertos(
  stripe: Stripe | null,
  customerId: string | null | undefined,
  clinicId: string,
  pagadoHasta: Date | null = null,
): Promise<string[]> {
  if (!stripe || !customerId || !clinicId) return [];
  const expiradas: string[] = [];
  try {
    const abiertas = await stripe.checkout.sessions.list({ customer: customerId, status: "open", limit: 100 });
    for (const s of abiertas.data) {
      if (s.metadata?.kind !== PLAN_UPGRADE_DIFF_KIND || s.metadata?.clinicId !== clinicId) continue;
      if (cotizadaSobreElPeriodoVigente(s.metadata, pagadoHasta)) continue;
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

/** ¿La sesión se cotizó sobre el periodo que la clínica tiene HOY? Solo con la fecha exacta de la metadata. */
function cotizadaSobreElPeriodoVigente(
  metadata: Record<string, string | undefined> | null | undefined,
  pagadoHasta: Date | null,
): boolean {
  if (!metadata?.paidUntil || !pagadoHasta || Number.isNaN(pagadoHasta.getTime())) return false;
  const cotizadoHasta = finDelPeriodoCotizado(metadata, null);
  return !!cotizadoHasta && cotizadoHasta.getTime() >= pagadoHasta.getTime();
}

/**
 * Aviso para quien administra la plataforma: la clínica PAGÓ un diferencial que
 * no se aplicó (revisión t8, m1). Sin él, el cobro solo dejaba un log y una
 * fila de bitácora que no avisa a nadie; hay que revisarlo y devolverlo a mano.
 */
export function avisoDiferencialDescartado(a: {
  clinicId: string;
  sessionId: string | null | undefined;
  motivo: string;
  planCotizado: string | null;
  detalle: Record<string, unknown>;
}): AvisoAdmin {
  return {
    asunto: `Diferencial de plan PAGADO y no aplicado (${a.motivo}): clínica ${a.clinicId}`,
    lineas: [
      "Una clínica pagó en Stripe la diferencia de un cambio de plan y el plan NO se aplicó.",
      `Clínica: ${a.clinicId}`,
      `Sesión de Checkout: ${a.sessionId ?? "(sin id)"}`,
      `Plan cotizado: ${a.planCotizado ?? "(inválido)"} · motivo: ${a.motivo}`,
      `Detalle: ${JSON.stringify(a.detalle)}`,
      "Motivos: period-changed = el periodo pagado cambió (renovó antes de pagar el voucher); period-expired = pagó con el periodo ya vencido; from-plan-changed = hoy está en un plan menor que el cotizado; not-a-tier-upgrade = ya tenía ese plan o uno mayor.",
      "Qué hacer: revisa el pago en Stripe y, si procede, devuélvelo a la clínica (o aplícale el plan a mano desde /admin).",
    ],
  };
}

// ── Marca «este diferencial YA se aplicó» (revisión t8, m3) ─────────────────
// Va en billing_email_logs (`invoiceId` ÚNICO, la misma tabla que el candado de
// los avisos; sin SQL). Distingue a Stripe reenviando una sesión ya aplicada
// (silencio) de un SEGUNDO voucher pagado del mismo upgrade (dinero cobrado dos
// veces → aviso).

const claveAplicado = (sessionId: string) => `${sessionId}:diferencial_aplicado`;

/** Deja la marca de la sesión aplicada. Nunca lanza: sin marca solo se pierde silenciar un reenvío. */
export async function marcarDiferencialAplicado(sessionId: string | null | undefined, clinicId: string): Promise<void> {
  if (!sessionId) return;
  try {
    await prisma.billingEmailLog.create({ data: { invoiceId: claveAplicado(sessionId), clinicId, kind: "diferencial_aplicado", email: "" } });
  } catch (e) {
    const code = (e as { code?: string } | null)?.code;
    if (code !== "P2002") console.error("[billing] no se pudo marcar el diferencial aplicado:", sessionId, code ?? e);
  }
}

/** ¿Esta sesión del diferencial ya se aplicó? Si no se puede leer, false: ante la duda, se avisa. */
export async function diferencialYaAplicado(sessionId: string | null | undefined): Promise<boolean> {
  if (!sessionId) return false;
  try {
    return !!(await prisma.billingEmailLog.findUnique({ where: { invoiceId: claveAplicado(sessionId) }, select: { id: true } }));
  } catch {
    return false;
  }
}
