// ═══════════════════════════════════════════════════════════════════════════
// Los nombres de un MÉTODO DE PAGO, normalizados (QA de Rafael, 5-oct-2026, #2).
// Puro, client-safe.
//
// En la base conviven valores viejos o de otras rutas además de los seis del
// cobro: «credit_card» (7), «debit_card» (5), «CARD» (3), «CASH» (1) — conteo de
// solo lectura del 5-oct-2026. La Caja enseñaba «credit_card» en inglés y lo
// sumaba en «Otros» del arqueo. Aquí se traducen a su método de siempre SIN
// tocar los datos: lo usan la etiqueta y la clasificación del arqueo y el corte.
// ═══════════════════════════════════════════════════════════════════════════

export type MetodoCanonico =
  | "cash" | "debit" | "credit" | "card" | "transfer" | "check" | "other"
  | "mercadopago" | "refund" | "anticipo" | "migrated" | "online";

const ALIAS: Record<string, MetodoCanonico> = {
  cash: "cash", efectivo: "cash",
  debit: "debit", debit_card: "debit", debitcard: "debit", tarjeta_debito: "debit", debito: "debit",
  credit: "credit", credit_card: "credit", creditcard: "credit", tarjeta_credito: "credit", credito: "credit",
  // «CARD» no dice si fue débito o crédito: es tarjeta, sin tipo.
  card: "card", tarjeta: "card",
  transfer: "transfer", transferencia: "transfer", spei: "transfer", wire: "transfer", bank_transfer: "transfer",
  check: "check", cheque: "check",
  other: "other", otro: "other",
  mercadopago: "mercadopago", mercado_pago: "mercadopago",
  refund: "refund", anticipo: "anticipo", migrated: "migrated", online: "online",
};

/** «CREDIT_CARD», « Cash », «debit-card» → su método de siempre. Desconocido → tal cual, en minúsculas. */
export function metodoCanonico(metodo: string | null | undefined): string {
  const k = String(metodo ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  return ALIAS[k] ?? k;
}

/** Todas las formas en que un método está escrito en la base (para un `where … in`). */
export function aliasDe(canonico: MetodoCanonico): string[] {
  const salida = new Set<string>();
  for (const [k, v] of Object.entries(ALIAS)) {
    if (v !== canonico) continue;
    salida.add(k);
    salida.add(k.toUpperCase());
  }
  return Array.from(salida);
}

/** Dónde suma en el arqueo de Caja: efectivo, débito, crédito u otros. */
export function grupoDelArqueo(metodo: string | null | undefined): "cash" | "debit" | "credit" | "other" {
  const c = metodoCanonico(metodo);
  return c === "cash" || c === "debit" || c === "credit" ? c : "other";
}
