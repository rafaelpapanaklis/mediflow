// ═══════════════════════════════════════════════════════════════════════════
// Comisión de afiliado frente a un REEMBOLSO o un CONTRACARGO (ola 2b, lead 10).
//
// La comisión nace «pending» en invoice.paid (webhooks/stripe/route.ts) y el
// payout masivo de /admin paga TODAS las «pending» de un afiliado. Antes nada
// la tocaba si después el cobro de la clínica se reembolsaba o se perdía un
// contracargo: se pagaba una comisión sobre dinero que DaleControl devolvió.
//
// Igual que la reversión del monedero de IA (ai-billing/reversion.ts), el
// evento solo avisa: el estado se le pide HOY a Stripe (cargos y disputas del
// PaymentIntent), así da igual el orden en que lleguen los eventos o cuántas
// veces llegue uno.
//
//   · reembolso TOTAL o contracargo PERDIDO      → "reversed" (no se paga)
//   · contracargo abierto (o consulta abierta)   → "disputed" (retenida)
//   · nada de lo anterior (ganado, reembolso que
//     falló, reembolso PARCIAL)                  → "pending"
//
// Solo se mueve entre esos tres estados. Una comisión YA PAGADA no se reescribe
// (el dinero ya salió): se deja el aviso en el log para recuperarla a mano.
// El reembolso PARCIAL no la anula: prorratearla es decisión de negocio.
// ═══════════════════════════════════════════════════════════════════════════
import type Stripe from "stripe";
import { prisma } from "@/lib/prisma";

export const COMISION_PENDIENTE = "pending";
export const COMISION_RETENIDA = "disputed";
export const COMISION_ANULADA = "reversed";

const MOVIBLES = [COMISION_PENDIENTE, COMISION_RETENIDA, COMISION_ANULADA];

/** Estados de disputa de Stripe que siguen abiertos (contracargo o consulta). */
const DISPUTA_ABIERTA = new Set(["warning_needs_response", "warning_under_review", "needs_response", "under_review"]);

type CargoLeido = { status?: string | null; amount_captured?: number | null; amount_refunded?: number | null };
type DisputaLeida = { status?: string | null };

/** Puro: a qué estado debe ir la comisión con lo que Stripe dice hoy de sus cargos y disputas. */
export function estadoDeComisionSegunStripe(cargos: CargoLeido[], disputas: DisputaLeida[]): string {
  if (disputas.some((d) => d.status === "lost")) return COMISION_ANULADA;
  const cobrados = cargos.filter((c) => c.status === "succeeded");
  const capturado = cobrados.reduce((s, c) => s + (c.amount_captured ?? 0), 0);
  const reembolsado = cobrados.reduce((s, c) => s + (c.amount_refunded ?? 0), 0);
  if (capturado > 0 && reembolsado >= capturado) return COMISION_ANULADA;
  if (disputas.some((d) => DISPUTA_ABIERTA.has(d.status ?? ""))) return COMISION_RETENIDA;
  return COMISION_PENDIENTE;
}

/** La factura de un cargo (la API fija del cliente, 2024-06-20, la trae en `charge.invoice`). */
function facturaDelCargo(c: unknown): string | null {
  const inv = (c as { invoice?: string | { id?: string } | null } | null)?.invoice;
  if (typeof inv === "string") return inv || null;
  return inv?.id || null;
}

export type ResultadoComision =
  | { aplicado: false }
  | { aplicado: true; invoiceId: string; estado: string; movidas: number };

/**
 * Cuadra las comisiones de la factura pagada con este PaymentIntent. Si el
 * PaymentIntent no es de una factura (teleconsulta, portal, recarga…) o la
 * factura no generó comisión, no hace nada. Si Stripe no contesta, LANZA: el
 * webhook responde 5xx y Stripe reintenta el evento.
 */
export async function cuadrarComisionConStripe(stripe: Stripe, paymentIntentId: string): Promise<ResultadoComision> {
  const cargos = await stripe.charges.list({ payment_intent: paymentIntentId, limit: 100 });
  const invoiceId = cargos.data.map(facturaDelCargo).find((x): x is string => !!x) ?? null;
  if (!invoiceId) return { aplicado: false };

  const filas = await prisma.affiliateCommission.findMany({
    where: { stripeInvoiceId: invoiceId },
    select: { id: true, status: true, affiliateId: true, commissionMxn: true },
  });
  if (filas.length === 0) return { aplicado: false };

  const disputas = await stripe.disputes.list({ payment_intent: paymentIntentId, limit: 100 });
  const estado = estadoDeComisionSegunStripe(cargos.data, disputas.data);

  // Ya pagada y ahora reembolsada/disputada: no se reescribe, se avisa.
  for (const f of filas) {
    if (!MOVIBLES.includes(f.status) && estado !== COMISION_PENDIENTE) {
      console.error(
        "[afiliados] comisión YA PAGADA sobre un cobro reembolsado o en contracargo: recuperarla a mano",
        JSON.stringify({ commissionId: f.id, affiliateId: f.affiliateId, commissionMxn: f.commissionMxn, invoiceId, paymentIntentId, estado }),
      );
    }
  }

  // Condicionado al estado: si el payout la marcó «paid» entre la lectura y
  // esta escritura, no se toca.
  const { count } = await prisma.affiliateCommission.updateMany({
    where: { stripeInvoiceId: invoiceId, status: { in: MOVIBLES.filter((s) => s !== estado) } },
    data: { status: estado },
  });
  return { aplicado: true, invoiceId, estado, movidas: count };
}
