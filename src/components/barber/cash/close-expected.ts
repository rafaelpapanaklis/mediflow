// Cómo se LEE el esperado al cerrar el turno. Solo presentación: ningún número
// se calcula aquí distinto de como ya lo calcula el servidor.
//
// Antes la pantalla listaba «Efectivo (10) $1,380.00», «Propinas en efectivo
// $30.00» y «Esperado $1,880.00», uno debajo del otro: parecía que las
// propinas había que sumarlas, y ya van dentro del efectivo cobrado.
//
// Ahora se separa lo que SUMA de lo que solo se explica:
//   Fondo inicial                       $500.00
//   + Efectivo cobrado (10)           $1,380.00
//       Incluye $30.00 de propinas (nota, sin columna de importe)
//   = Esperado en efectivo            $1,880.00
//   No está en el cajón: Tarjeta, Transferencia (aparte, no suman)
//
// Puro: sin React ni servidor, para poder probarlo.
import type { BarberPaymentMethod } from "@/lib/barber/types";
import type { CashSessionSummary } from "@/lib/barber/cash";

/** Métodos que se cobran fuera del cajón, en el orden en que se enseñan. */
export const CLOSE_OUTSIDE_METHODS = ["CARD", "SPEI"] as const satisfies readonly BarberPaymentMethod[];

export interface CloseExpectedView {
  /** Sumando 1: el fondo con el que se abrió el turno. */
  opening: number;
  /** Sumando 2: todo lo cobrado en efectivo en el turno, propinas incluidas. */
  cashCharged: number;
  cashTickets: number;
  /**
   * Parte de `cashCharged` que son propinas. Es una NOTA del sumando 2, no un
   * tercer sumando: 0 = no se enseña.
   */
  cashTipsIncluded: number;
  /** El esperado que calculó el servidor (= opening + cashCharged). */
  expected: number;
  /** Lo cobrado por otros medios: informativo, no entra al conteo del cajón. */
  outside: Array<{ method: (typeof CLOSE_OUTSIDE_METHODS)[number]; count: number; total: number }>;
}

type SummaryForClose = Pick<CashSessionSummary, "byMethod" | "cashTips" | "expectedCash"> & {
  session: Pick<CashSessionSummary["session"], "openingAmount">;
};

export function closeExpectedView(summary: SummaryForClose): CloseExpectedView {
  return {
    opening: summary.session.openingAmount,
    cashCharged: summary.byMethod.CASH.total,
    cashTickets: summary.byMethod.CASH.count,
    cashTipsIncluded: summary.cashTips,
    expected: summary.expectedCash,
    outside: CLOSE_OUTSIDE_METHODS.map((method) => ({
      method,
      count: summary.byMethod[method].count,
      total: summary.byMethod[method].total,
    })),
  };
}
