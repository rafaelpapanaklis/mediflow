import "server-only";
import { prisma } from "@/lib/prisma";
import { env } from "@/env";
import { getPayment } from "@/lib/mercadopago";

/**
 * Recarga del monedero de IA vía MercadoPago (one-shot, sin auto-recarga).
 *
 * A diferencia de las órdenes B2B (lab/proveedor), que cobran a la cuenta del
 * vendedor con su propio token, ESTA recarga la cobra MediFlow con su token de
 * PLATAFORMA (`MERCADOPAGO_ACCESS_TOKEN`). Por eso vive en su propio módulo y no
 * toca la lib `ai-billing` (T1) ni el flujo de proveedores.
 *
 * Dinero SIEMPRE en centavos enteros (Int) MXN. La fuente de verdad del monto es
 * `AiTopup.amountCents` (lo que se acredita), NUNCA el float que devuelve MP.
 */

// external_reference / ?ref con el que MercadoPago nos devuelve la recarga.
// Formato: "aitopup:<AiTopup.id>". El webhook COMPARTIDO lo usa para distinguir
// las recargas del monedero (aitopup:) de las órdenes B2B (lab:/sup:).
const MP_TOPUP_PREFIX = "aitopup";

/** Construye el ref ancla del pago a partir del id del AiTopup. */
export function buildMpTopupRef(topupId: string): string {
  return `${MP_TOPUP_PREFIX}:${topupId}`;
}

/**
 * Verifica un pago contra la cuenta de PLATAFORMA y, si está aprobado y su
 * external_reference apunta exactamente a este topup (anti-spoof, mismo patrón
 * que el flujo B2B), acredita el saldo de forma ATÓMICA e IDEMPOTENTE.
 *
 * Pensado para el webhook: si `getPayment` falla, deja propagar el error al
 * try/catch del webhook (que responde 200 igual); MercadoPago reintenta y el
 * claim atómico evita la doble acreditación.
 */
export async function verifyAndCreditMpTopup(topupId: string, paymentId: string): Promise<void> {
  const token = env.MERCADOPAGO_ACCESS_TOKEN;
  if (!token) {
    console.error("[ai-topup] MERCADOPAGO_ACCESS_TOKEN no configurado; no se puede verificar el pago");
    return;
  }

  const pay = await getPayment(token, paymentId);
  if (pay.status !== "approved" || pay.externalReference !== buildMpTopupRef(topupId)) {
    return;
  }

  await creditMpTopup(topupId, paymentId);
}

/**
 * Acredita el saldo en UNA transacción e idempotente: solo la PRIMERA entrega
 * que gane el flip PENDING→PAID acredita (claim atómico vía updateMany — toma el
 * lock de la fila, así dos entregas concurrentes no doblan el saldo). Suma a
 * `balanceCents`, registra `AiWalletTransaction(TOPUP, MERCADOPAGO)` con el saldo
 * resultante y marca el `AiTopup` PAID con el id del pago.
 */
async function creditMpTopup(topupId: string, paymentId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    // Claim atómico: PENDING→PAID. Si otra entrega ya lo tomó (o no es MP, o el
    // monto no es positivo) el count es 0 y no acreditamos nada.
    const claim = await tx.aiTopup.updateMany({
      where: { id: topupId, status: "PENDING", method: "MERCADOPAGO", amountCents: { gt: 0 } },
      data: { status: "PAID", paidAt: new Date(), gatewayRef: paymentId },
    });
    if (claim.count === 0) return;

    // Ganamos el claim: la fila existe y amountCents > 0 (garantizado por el WHERE).
    const topup = await tx.aiTopup.findUniqueOrThrow({ where: { id: topupId } });

    // Alta perezosa del monedero + incremento atómico del saldo (centavos MXN).
    const wallet = await tx.aiWallet.upsert({
      where: { clinicId: topup.clinicId },
      create: { clinicId: topup.clinicId, balanceCents: topup.amountCents },
      update: { balanceCents: { increment: topup.amountCents } },
    });

    await tx.aiWalletTransaction.create({
      data: {
        clinicId: topup.clinicId,
        type: "TOPUP",
        amountCents: topup.amountCents,
        balanceAfterCents: wallet.balanceCents,
        source: "MERCADOPAGO",
        reference: paymentId,
      },
    });
  });
}
