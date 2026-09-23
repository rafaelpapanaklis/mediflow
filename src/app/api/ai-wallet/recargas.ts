import type { Prisma } from "@prisma/client";

/**
 * «Recargas de saldo» de la pantalla de Saldo de IA: SOLO el dinero que ENTRA.
 *
 * Antes el bloque se llamaba «Recargas y movimientos» y listaba el libro mayor
 * entero (`ai_wallet_transactions`), consumos incluidos. Eso repetía lo que ya
 * enseña «Consumo de IA» y, con `take: 20`, veinte respuestas del bot dejaban
 * fuera la única recarga que la clínica quería ver. Rafael pidió que aquí
 * salgan solo las recargas; los `CHARGE` tienen su sitio arriba.
 *
 * Qué entra:
 *   · TOPUP        — pagada por pasarela (tarjeta, Mercado Pago) o SPEI ya
 *                    confirmada por administración.
 *   · ADJUSTMENT>0 — abono a mano desde /admin (`ai-billing/adjust`). Uno
 *                    negativo es un cargo, no una recarga: no sale.
 *   · REFUND       — hoy ningún código la crea (solo el enum). Si un día
 *                    aparece es dinero que se mueve y NO es consumo, y sin ella
 *                    la lista de recargas no cuadraría con el saldo: se enseña
 *                    como «Devolución».
 *   · SPEI en revisión — `ai_topups` PENDING con método SPEI: el comprobante ya
 *                    se subió y el saldo aún no entra. Cuando administración
 *                    la confirma, el topup pasa a PAID y nace su asiento
 *                    TOPUP/SPEI; este renglón se va y queda aquel. Las PENDING
 *                    de Stripe/Mercado Pago no se enseñan: son checkouts que se
 *                    abrieron y se abandonaron, no pagos.
 *
 * Sin `server-only` y sin Prisma en tiempo de ejecución: el filtro y el mapeo se
 * prueban con `tsx --test` (src/app/api/ai-wallet/__tests__/recargas.test.ts).
 * Solo lo consume `GET /api/ai-wallet`, que a su vez solo lo lee la pantalla de
 * Saldo de IA (grep del 22-sep-2026): recortar en el servidor no le quita la
 * lista a nadie más.
 */

export type TipoAsiento = "TOPUP" | "CHARGE" | "REFUND" | "ADJUSTMENT";
export type OrigenAsiento = "STRIPE" | "MERCADOPAGO" | "SPEI" | "USAGE" | "ADMIN";

/** Lo que se lee de un asiento del libro mayor (estructural, sin Prisma). */
export interface AsientoMonedero {
  id: string;
  type: TipoAsiento;
  amountCents: number;
  balanceAfterCents: number;
  source: OrigenAsiento;
  note: string | null;
  createdAt: Date;
}

/** Recarga por SPEI con comprobante subido y todavía sin confirmar. */
export interface SpeiEnRevision {
  id: string;
  amountCents: number;
  createdAt: Date;
}

/** Un renglón del bloque «Recargas de saldo», ya listo para la pantalla. */
export interface RecargaFila {
  id: string;
  /**
   * TOPUP = pasarela · ADJUSTMENT = abono a mano · REFUND = devolución ·
   * SPEI_EN_REVISION = comprobante subido, saldo todavía sin acreditar.
   */
  tipo: "TOPUP" | "REFUND" | "ADJUSTMENT" | "SPEI_EN_REVISION";
  /** Por dónde entró el dinero. `null` si no aplica. */
  via: "STRIPE" | "MERCADOPAGO" | "SPEI" | "ADMIN" | null;
  amountCents: number;
  /** `null` mientras está en revisión: todavía no tocó el saldo. */
  balanceAfterCents: number | null;
  note: string | null;
  createdAt: Date;
  /** true solo en las SPEI en revisión. */
  enRevision: boolean;
}

/**
 * ¿Este asiento es dinero que ENTRA? La regla en un solo sitio: la misma que
 * expresa `filtroRecargas` en Prisma, para que la prueba la fije y el servidor
 * no pueda divergir de ella.
 */
export function esRecarga(a: Pick<AsientoMonedero, "type" | "amountCents">): boolean {
  if (a.type === "TOPUP" || a.type === "REFUND") return true;
  if (a.type === "ADJUSTMENT") return a.amountCents > 0;
  return false; // CHARGE: consumo, vive en «Consumo de IA».
}

/** El mismo criterio que `esRecarga`, en forma de `where` de Prisma. */
export function filtroRecargas(clinicId: string): Prisma.AiWalletTransactionWhereInput {
  return {
    clinicId,
    OR: [
      { type: { in: ["TOPUP", "REFUND"] } },
      { type: "ADJUSTMENT", amountCents: { gt: 0 } },
    ],
  };
}

/** `where` de las SPEI en revisión (`ai_topups`), SIEMPRE por clínica. */
export function filtroSpeiEnRevision(clinicId: string): Prisma.AiTopupWhereInput {
  return { clinicId, method: "SPEI", status: "PENDING" };
}

function viaDeOrigen(source: OrigenAsiento): RecargaFila["via"] {
  switch (source) {
    case "STRIPE":
    case "MERCADOPAGO":
    case "SPEI":
    case "ADMIN":
      return source;
    default:
      return null; // USAGE no es una vía de entrada.
  }
}

/** Convierte un asiento en renglón; `null` si no es una recarga (defensa en profundidad). */
export function filaDeAsiento(a: AsientoMonedero): RecargaFila | null {
  if (!esRecarga(a)) return null;
  return {
    id: a.id,
    tipo: a.type as RecargaFila["tipo"],
    via: viaDeOrigen(a.source),
    amountCents: a.amountCents,
    balanceAfterCents: a.balanceAfterCents,
    note: a.note,
    createdAt: a.createdAt,
    enRevision: false,
  };
}

export function filaDeSpeiEnRevision(t: SpeiEnRevision): RecargaFila {
  return {
    id: `spei:${t.id}`,
    tipo: "SPEI_EN_REVISION",
    via: "SPEI",
    amountCents: t.amountCents,
    balanceAfterCents: null,
    note: null,
    createdAt: t.createdAt,
    enRevision: true,
  };
}

/** Asientos + SPEI en revisión, de la más reciente a la más antigua. */
export function juntarRecargas(asientos: AsientoMonedero[], enRevision: SpeiEnRevision[]): RecargaFila[] {
  const filas: RecargaFila[] = [];
  for (const a of asientos) {
    const fila = filaDeAsiento(a);
    if (fila) filas.push(fila);
  }
  for (const t of enRevision) filas.push(filaDeSpeiEnRevision(t));
  return filas.sort((x, y) => y.createdAt.getTime() - x.createdAt.getTime());
}
