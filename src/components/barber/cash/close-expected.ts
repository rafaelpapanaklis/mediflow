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
//   + Entradas de efectivo              $200.00   (solo si hubo)
//   − Gastos en efectivo                 $80.00   (solo si hubo)
//   − Retiros                         $1,000.00   (solo si hubo)
//   − Pagos a barberos en efectivo      $200.00   (solo si hubo)
//   − Anticipos devueltos en efectivo   $100.00   (solo si hubo)
//   = Esperado en efectivo              $500.00
//   No está en el cajón: Tarjeta, Transferencia (aparte, no suman)
//
// Los sumandos vienen del servidor (resumen.esperado, la fórmula única de
// src/lib/barber/caja-resumen.ts). Un resumen viejo sin `resumen` (o una
// prueba) se lee como antes: fondo + efectivo = esperado.
//
// Puro: sin React ni servidor, para poder probarlo.
import type { BarberPaymentMethod } from "@/lib/barber/types";
import type { CashSessionSummary } from "@/lib/barber/cash";
import type { EsperadoDesglose } from "@/lib/barber/caja-resumen";

/** Métodos que se cobran fuera del cajón, en el orden en que se enseñan. */
export const CLOSE_OUTSIDE_METHODS = ["CARD", "SPEI"] as const satisfies readonly BarberPaymentMethod[];

/** Los sumandos que RESTAN (o suman, cashIn) aparte del fondo y el efectivo cobrado, en el orden del corte. */
export const CLOSE_EXTRA_ROWS = ["cashIn", "cashExpenses", "withdrawals", "cashPayouts", "cashRefunds"] as const;
export type CloseExtraRow = (typeof CLOSE_EXTRA_ROWS)[number];

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
  /** Entradas (+) y salidas (−) del cajón que no son tickets; solo las que no valen 0. */
  extras: Array<{ key: CloseExtraRow; sign: "+" | "−"; amount: number }>;
  /** El esperado que calculó el servidor. */
  expected: number;
  /** Lo cobrado por otros medios: informativo, no entra al conteo del cajón. */
  outside: Array<{ method: (typeof CLOSE_OUTSIDE_METHODS)[number]; count: number; total: number }>;
}

type SummaryForClose = Pick<CashSessionSummary, "byMethod" | "cashTips" | "expectedCash"> & {
  session: Pick<CashSessionSummary["session"], "openingAmount">;
  resumen?: { esperado: EsperadoDesglose } | null;
};

export function closeExpectedView(summary: SummaryForClose): CloseExpectedView {
  const e = summary.resumen?.esperado ?? null;
  const extras: CloseExpectedView["extras"] = [];
  if (e) {
    for (const key of CLOSE_EXTRA_ROWS) {
      const amount = e[key];
      if (amount !== 0) extras.push({ key, sign: key === "cashIn" ? "+" : "−", amount });
    }
  }
  return {
    opening: e ? e.opening : summary.session.openingAmount,
    cashCharged: e ? e.cashCharged : summary.byMethod.CASH.total,
    cashTickets: e ? e.cashTickets : summary.byMethod.CASH.count,
    cashTipsIncluded: e ? e.cashTipsIncluded : summary.cashTips,
    extras,
    expected: summary.expectedCash,
    outside: CLOSE_OUTSIDE_METHODS.map((method) => ({
      method,
      count: summary.byMethod[method].count,
      total: summary.byMethod[method].total,
    })),
  };
}
