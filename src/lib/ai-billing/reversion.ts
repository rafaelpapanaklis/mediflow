import "server-only";
import { prisma } from "@/lib/prisma";
import type Stripe from "stripe";
import { deltaReversion, objetivoReversionStripe } from "./reversion-core";

/**
 * Reembolsos y contracargos de recargas del monedero (H3). La regla vive en
 * `reversion-core.ts`; aquí, la base.
 *
 * 🔴 EL SALDO YA GASTADO: se descuenta igual y el monedero queda en NEGATIVO,
 * a la vista en su lista de movimientos. Recargó $200, gastó $150 y le
 * devolvieron $200 → queda en −$150. Topar en 0 le regalaría a la clínica los
 * $150 de IA que ya usó y que ya no está pagando. Con el saldo negativo la IA de
 * pago se para (bot a una persona, Sabina lo dice), y la siguiente recarga
 * cubre primero ese negativo.
 *
 * Y cuando se descuenta, se APAGA la auto-recarga: con el saldo bajo el umbral,
 * el cron volvería a cobrar la misma tarjeta que se acaba de reembolsar o que
 * está en disputa. La clínica puede volver a encenderla ella misma.
 */

export type MetodoRecarga = "STRIPE" | "MERCADOPAGO";

export interface ResultadoReversion {
  /** false = no es una recarga pagada del monedero (otro cobro de Stripe/MP), o ya cuadraba. */
  aplicado: boolean;
  clinicId: string | null;
  /** Lo que se movió: positivo = descontado, negativo = devuelto. */
  deltaCents: number;
  balanceAfterCents: number | null;
}

const SIN_CAMBIO: ResultadoReversion = { aplicado: false, clinicId: null, deltaCents: 0, balanceAfterCents: null };

/** La recarga PAGADA de esa pasarela con esa referencia (pi.id / id de pago de MP). */
export async function recargaPagada(metodo: MetodoRecarga, gatewayRef: string) {
  if (!gatewayRef) return null;
  return prisma.aiTopup.findFirst({
    where: { gatewayRef, method: metodo, status: "PAID" },
    select: { id: true, clinicId: true, amountCents: true },
  });
}

/**
 * Cuadra el saldo de UNA recarga contra lo que la pasarela dice HOY, y vuelve a
 * preguntar después de cada cambio hasta que no haya nada que mover.
 *
 * Por qué el bucle: a la pasarela se le pregunta ANTES de bloquear el monedero
 * (no se hace una llamada de red con la fila bloqueada). Un aviso que leyó
 * «reembolsado $50» puede entrar al candado DESPUÉS de otro que leyó «$100» y
 * ya descontó $100: con su dato viejo devolvería $50. Como cada uno vuelve a
 * preguntar tras mover el saldo, el último en terminar lo hace con el dato
 * fresco y deja el saldo donde corresponde. Tope de 4 vueltas.
 */
export async function cuadrarConLaPasarela(p: {
  metodo: MetodoRecarga;
  gatewayRef: string;
  topupId?: string;
  /** Lo que HOY está devuelto o retenido, y por qué. Se llama al menos una vez por vuelta. */
  leerObjetivo: (recargaCents: number) => Promise<{ objetivoCents: number; motivo: string }>;
}): Promise<ResultadoReversion> {
  const recarga = await recargaPagada(p.metodo, p.gatewayRef);
  if (!recarga) return SIN_CAMBIO;
  if (p.topupId && recarga.id !== p.topupId) return SIN_CAMBIO;

  let total: ResultadoReversion = { ...SIN_CAMBIO, clinicId: recarga.clinicId };
  for (let vuelta = 0; vuelta < 4; vuelta++) {
    const { objetivoCents, motivo } = await p.leerObjetivo(recarga.amountCents);
    const r = await cuadrarReversion({ metodo: p.metodo, gatewayRef: p.gatewayRef, topupId: p.topupId, objetivoCents, motivo });
    if (!r.aplicado) break;
    total = {
      aplicado: true,
      clinicId: r.clinicId,
      deltaCents: total.deltaCents + r.deltaCents,
      balanceAfterCents: r.balanceAfterCents,
    };
  }
  return total;
}

/**
 * Cuadra el saldo de UNA recarga contra el objetivo que diga la pasarela.
 * Idempotente: bajo el candado del monedero (FOR UPDATE, el mismo que usan el
 * abono de Stripe y el cobro de uso) se suma lo ya revertido y solo se mueve la
 * diferencia. Dos entregas a la vez del mismo evento: la segunda espera al
 * candado, ve el REFUND de la primera y no hace nada.
 *
 * El `clinicId` sale de NUESTRA fila `ai_topups`, nunca del evento.
 */
export async function cuadrarReversion(p: {
  metodo: MetodoRecarga;
  gatewayRef: string;
  /** Si se sabe, el id de la recarga (MP lo trae en su ref): si no coincide, no se toca nada. */
  topupId?: string;
  objetivoCents: number;
  /** Por qué se descuenta, en palabras de la clínica. Va a la nota del movimiento. */
  motivo: string;
}): Promise<ResultadoReversion> {
  const recarga = await recargaPagada(p.metodo, p.gatewayRef);
  if (!recarga) return SIN_CAMBIO;
  if (p.topupId && recarga.id !== p.topupId) return SIN_CAMBIO;

  const objetivo = Math.min(Math.max(0, Math.floor(p.objetivoCents)), recarga.amountCents);

  return prisma.$transaction(async (tx) => {
    // Serializa con el abono, el cobro de uso y otra entrega de este evento.
    await tx.$queryRaw`SELECT id FROM ai_wallets WHERE "clinicId" = ${recarga.clinicId} FOR UPDATE`;

    const previos = await tx.aiWalletTransaction.aggregate({
      where: { clinicId: recarga.clinicId, type: "REFUND", source: p.metodo, reference: p.gatewayRef },
      _sum: { amountCents: true },
    });
    // Los REFUND que descuentan son negativos: lo revertido es su suma cambiada de signo.
    const yaRevertido = -(previos._sum.amountCents ?? 0);
    const delta = deltaReversion(objetivo, yaRevertido);
    if (delta === 0) return { ...SIN_CAMBIO, clinicId: recarga.clinicId };

    const wallet = await tx.aiWallet.update({
      where: { clinicId: recarga.clinicId },
      data: {
        balanceCents: { decrement: delta },
        ...(delta > 0 ? { autoRecharge: false } : {}),
      },
    });

    const quedaNegativo = delta > 0 && wallet.balanceCents < 0;
    const nota =
      delta > 0
        ? `${p.motivo}: se descuenta el saldo de esa recarga.` +
          (quedaNegativo ? " Parte ya se había gastado, así que el saldo queda en negativo." : "") +
          " Se apagó la auto-recarga."
        : "Se devuelve el saldo que se había descontado por esta recarga: la disputa se ganó o el reembolso no se completó.";

    await tx.aiWalletTransaction.create({
      data: {
        clinicId: recarga.clinicId,
        type: "REFUND",
        amountCents: -delta,
        balanceAfterCents: wallet.balanceCents,
        source: p.metodo,
        reference: p.gatewayRef,
        note: nota,
      },
    });

    return { aplicado: true, clinicId: recarga.clinicId, deltaCents: delta, balanceAfterCents: wallet.balanceCents };
  });
}

/**
 * Stripe: cuadra la recarga de un PaymentIntent con lo que Stripe dice HOY de
 * sus cargos y disputas. El evento solo avisa; los números se le piden a la API,
 * así da igual el orden en que lleguen los eventos o cuántas veces llegue uno.
 * Si el PaymentIntent no es una recarga pagada del monedero (una suscripción,
 * teleconsulta…), no llama a Stripe y no hace nada.
 */
export async function revertirRecargaStripe(stripe: Stripe, paymentIntentId: string): Promise<ResultadoReversion> {
  return cuadrarConLaPasarela({
    metodo: "STRIPE",
    gatewayRef: paymentIntentId,
    leerObjetivo: async (recargaCents) => {
      const [cargos, disputas] = await Promise.all([
        stripe.charges.list({ payment_intent: paymentIntentId, limit: 100 }),
        stripe.disputes.list({ payment_intent: paymentIntentId, limit: 100 }),
      ]);
      const { objetivoCents, reembolsoCents, disputaCents } = objetivoReversionStripe({
        recargaCents,
        reembolsadoCents: cargos.data.reduce((s, c) => s + (c.amount_refunded ?? 0), 0),
        disputas: disputas.data.map((d) => ({ amount: d.amount, status: d.status })),
      });
      return {
        objetivoCents,
        motivo:
          disputaCents > 0 && reembolsoCents > 0
            ? "Reembolso y contracargo de la recarga con tarjeta"
            : disputaCents > 0
              ? "Contracargo de la recarga con tarjeta"
              : "Reembolso de la recarga con tarjeta",
      };
    },
  });
}

/** El PaymentIntent de un objeto de evento de Stripe (Charge, Refund o Dispute). */
export function paymentIntentDeEvento(obj: unknown): string | null {
  const pi = (obj as { payment_intent?: string | { id?: string } | null } | null)?.payment_intent;
  if (typeof pi === "string") return pi || null;
  return pi?.id || null;
}
