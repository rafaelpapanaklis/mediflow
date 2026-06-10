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
 * Pensado para el webhook: si `getPayment` falla de forma TRANSITORIA (red,
 * 5xx/429 de MP), deja propagar el error — el webhook responde 500, MercadoPago
 * REINTENTA y el claim atómico evita la doble acreditación. Si el pago no
 * existe o no aplica (determinista: getPayment devuelve null, no aprobado, ref
 * que no coincide), retorna sin acreditar y el webhook responde 200.
 */
export async function verifyAndCreditMpTopup(topupId: string, paymentId: string): Promise<void> {
  const token = env.MERCADOPAGO_ACCESS_TOKEN;
  if (!token) {
    // Sin token NO podemos verificar un pago que puede ser real: lanzamos (el
    // webhook responde 500) para que MP reintente, en vez de tragarnos con un
    // 200 una recarga aprobada y dejarla PENDING para siempre.
    console.error("[ai-topup] MERCADOPAGO_ACCESS_TOKEN no configurado; no se puede verificar el pago");
    throw new Error("MERCADOPAGO_ACCESS_TOKEN no configurado");
  }

  const pay = await getPayment(token, paymentId);
  if (!pay || pay.status !== "approved" || pay.externalReference !== buildMpTopupRef(topupId)) {
    return;
  }

  // Reconciliación de monto/moneda (defensa en profundidad, mismo espíritu que las
  // ramas B2B del webhook): el pago real debe cubrir los centavos del AiTopup y
  // venir en MXN. Fallar aquí es DETERMINISTA (pago menor/moneda ajena no cambian
  // al reintentar): no se acredita, se loguea y el webhook responde 200.
  const topup = await prisma.aiTopup.findUnique({
    where: { id: topupId },
    select: { amountCents: true },
  });
  if (!topup) return;
  const paidCents =
    pay.transactionAmount != null ? Math.round(pay.transactionAmount * 100) : null;
  if (paidCents == null || paidCents < topup.amountCents || pay.currencyId !== "MXN") {
    console.error(
      `[ai-topup] pago ${paymentId} NO cubre el topup ${topupId}: pagado=${paidCents ?? "?"} ${pay.currencyId ?? "?"}, esperado>=${topup.amountCents} MXN centavos; no se acredita`,
    );
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
