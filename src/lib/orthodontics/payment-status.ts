// Orthodontics — cálculo determinista del status del plan de pagos. SPEC §1.11 + §5.3.
//
// Mapping (regla "max severity"):
//   - Todas pagadas (PAID) o perdonadas (WAIVED)        → PAID_IN_FULL
//   - Alguna vencida >30 días sin pago                  → SEVERE_DELAY
//   - Alguna vencida 1-30 días sin pago                 → LIGHT_DELAY
//   - Caso contrario                                    → ON_TIME
//
// El cálculo es server-side (action recalculatePaymentStatus + trigger SQL).
// Este helper se usa también en cliente para preview optimista.

import type { InstallmentStatus, OrthoPaymentStatus } from "@prisma/client";

export interface InstallmentForStatus {
  amount: number;
  dueDate: Date;
  status: InstallmentStatus;
  paidAt: Date | null;
}

export interface PaymentStatusResult {
  status: OrthoPaymentStatus;
  daysOverdue: number;
  amountOverdue: number;
}

/**
 * Resuelve el status global a partir de los installments. Idempotente.
 * `now` es inyectable para tests.
 */
export function computePaymentStatus(
  installments: InstallmentForStatus[],
  now: Date = new Date(),
): PaymentStatusResult {
  const pending = installments.filter(
    (i) => i.status !== "WAIVED" && i.paidAt === null,
  );
  const allSettled =
    installments.length > 0 &&
    installments.every((i) => i.status === "PAID" || i.status === "WAIVED");

  if (allSettled) {
    return { status: "PAID_IN_FULL", daysOverdue: 0, amountOverdue: 0 };
  }

  const overdue = pending.filter((i) => i.dueDate < now);
  if (overdue.length === 0) {
    return { status: "ON_TIME", daysOverdue: 0, amountOverdue: 0 };
  }

  const maxDelay = overdue.reduce((max, i) => {
    const delay = daysBetween(i.dueDate, now);
    return delay > max ? delay : max;
  }, 0);

  const amountOverdue = overdue.reduce((sum, i) => sum + i.amount, 0);

  if (maxDelay > 30) {
    return { status: "SEVERE_DELAY", daysOverdue: maxDelay, amountOverdue };
  }
  return { status: "LIGHT_DELAY", daysOverdue: maxDelay, amountOverdue };
}

/** Días enteros entre dos fechas (truncado, ignora horas). */
export function daysBetween(from: Date, to: Date): number {
  const ms = to.getTime() - from.getTime();
  return Math.floor(ms / 86_400_000);
}
