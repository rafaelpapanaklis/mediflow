// Nombres de los movimientos de caja para la lista, el corte y Gastos
// (ws6-t1). Puro y client-safe, aparte de movement-modals.tsx para que la
// lista del día y el detalle de un corte no arrastren el subidor de fotos.
import type { CashMovementRow } from "@/lib/barber/cash-movements";
import { CASH_EXPENSE_CATEGORIES } from "@/lib/barber/caja-movimientos-core";

type T = (k: string, v?: Record<string, string | number>) => string;

/** Etiqueta de una categoría guardada (clave conocida → diccionario; otra → tal cual). */
export function categoryLabel(t: T, category: string | null): string {
  if (!category) return t("mov.cat.none");
  return (CASH_EXPENSE_CATEGORIES as readonly string[]).includes(category) ? t(`mov.cat.${category}`) : category;
}

/** Título corto de un movimiento para la lista y los diálogos. */
export function movementTitle(t: T, m: Pick<CashMovementRow, "type" | "category" | "payoutKind" | "barberName">): string {
  switch (m.type) {
    case "EXPENSE":
      return `${t("mov.type.EXPENSE")} · ${categoryLabel(t, m.category)}`;
    case "WITHDRAWAL":
      return t("mov.type.WITHDRAWAL");
    case "DEPOSIT":
      return t("mov.type.DEPOSIT");
    default:
      return `${t(`mov.payout.${m.payoutKind ?? "OTHER"}`)} · ${m.barberName ?? "—"}`;
  }
}
