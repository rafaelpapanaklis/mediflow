// El corte de caja como TEXTO (ws6-t1): el mismo que se imprime se manda por
// WhatsApp (wa.me, sin API: solo abre WhatsApp con el texto listo). Puro y
// client-safe; las cifras vienen ya calculadas del servidor (resumen único).
import type { CashSessionSummary } from "@/lib/barber/cash";
import { CASH_DENOMINATIONS, differenceKind } from "@/lib/barber/caja-movimientos-core";
import { fmtDateTime, fmtMoney, fmtSigned, toCents, fromCents } from "./money";
import { CLOSE_EXTRA_ROWS } from "./close-expected";

type T = (k: string, v?: Record<string, string | number>) => string;

export type CorteSummary = Pick<CashSessionSummary, "session" | "resumen" | "expectedCash">;

/** Diferencia contado − esperado del corte, en centavos (null si no está cerrado). */
export function corteDiffCents(s: Pick<CashSessionSummary, "session">): number | null {
  const { countedAmount, expectedAmount } = s.session;
  if (countedAmount === null || expectedAmount === null) return null;
  return toCents(countedAmount) - toCents(expectedAmount);
}

/** «Cuadra», «Sobran $X» o «Faltan $X». */
export function corteDiffLabel(t: T, diffCents: number): string {
  const kind = differenceKind(diffCents);
  if (kind === "ok") return t("corte.diffOk");
  return t(kind === "over" ? "corte.diffOver" : "corte.diffShort", { amount: fmtMoney(Math.abs(fromCents(diffCents))) });
}

/** Etiqueta de una denominación del conteo («$500», «$0.50», «$20 moneda»). */
export function denominationLabel(t: T, key: string): string {
  const d = CASH_DENOMINATIONS.find((x) => x.key === key);
  if (!d) return key;
  const base = fmtMoney(d.cents / 100).replace(/\.00$/, "");
  return d.kind === "coin" && CASH_DENOMINATIONS.some((x) => x.kind === "bill" && x.cents === d.cents) ? `${base} ${t("corte.coin")}` : base;
}

/**
 * Texto del corte para WhatsApp. Una línea por cifra, en el orden del corte
 * impreso: esperado desglosado, contado, diferencia, fondo para mañana,
 * ingresos por método, propinas y gastos por categoría.
 */
export function corteWhatsappText(
  s: CorteSummary,
  opts: { shopName: string; tz: string; t: T; categoryLabel: (c: string) => string },
): string {
  const { t, tz } = opts;
  const r = s.resumen;
  const e = r.esperado;
  const lines: string[] = [];
  lines.push(`*${t("corte.title")} · ${opts.shopName}*`);
  lines.push(`${t("corte.opened")}: ${fmtDateTime(s.session.openedAt, tz)} (${s.session.openedByName})`);
  if (s.session.closedAt) lines.push(`${t("corte.closed")}: ${fmtDateTime(s.session.closedAt, tz)} (${s.session.closedByName ?? "—"})`);
  lines.push("");
  lines.push(`${t("caja.openingAmount")}: ${fmtMoney(e.opening)}`);
  lines.push(`+ ${t("session.cashCharged")}: ${fmtMoney(e.cashCharged)}`);
  for (const key of CLOSE_EXTRA_ROWS) {
    if (e[key] !== 0) lines.push(`${key === "cashIn" ? "+" : "−"} ${t(`session.sum.${key}`)}: ${fmtMoney(e[key])}`);
  }
  const expected = s.session.expectedAmount ?? s.expectedCash;
  lines.push(`= ${t("session.expected")}: ${fmtMoney(expected)}`);
  if (s.session.countedAmount !== null) {
    lines.push(`${t("corte.counted")}: ${fmtMoney(s.session.countedAmount)}`);
    const diff = corteDiffCents(s);
    if (diff !== null) lines.push(`${t("corte.difference")}: ${corteDiffLabel(t, diff)}`);
  }
  if (s.session.leftForNext !== null && s.session.leftForNext !== undefined) {
    lines.push(`${t("corte.leftForNext")}: ${fmtMoney(s.session.leftForNext)}`);
  }
  lines.push("");
  lines.push(`*${t("cards.income")}: ${fmtMoney(r.income.total)}*`);
  lines.push(`${t("common.cash")}: ${fmtMoney(r.income.byMethod.CASH.total)} · ${t("common.card")}: ${fmtMoney(r.income.byMethod.CARD.total)} · ${t("common.spei")}: ${fmtMoney(r.income.byMethod.SPEI.total)}${r.income.byMethod.ONLINE.count > 0 ? ` · ${t("cards.online")}: ${fmtMoney(r.income.byMethod.ONLINE.total)}` : ""}`);
  lines.push(`${t("corte.tickets")}: ${r.tickets.count} · ${t("corte.average")}: ${fmtMoney(r.tickets.average)}`);
  if (r.tips.total > 0) lines.push(`${t("caja.tipsTotal")}: ${fmtMoney(r.tips.total)}`);
  if (r.expenses.count > 0) {
    lines.push("");
    lines.push(`*${t("cards.expenses")}: ${fmtMoney(r.expenses.total)}*`);
    for (const c of r.expenses.byCategory) lines.push(`${opts.categoryLabel(c.category)}: ${fmtMoney(c.total)}`);
  }
  if (r.payouts.total > 0) lines.push(`${t("corte.payouts")}: ${fmtMoney(r.payouts.total)}`);
  if (r.withdrawals.total > 0 || r.deposits.total > 0) {
    lines.push(`${t("corte.withdrawals")}: ${fmtSigned(-r.withdrawals.total)} · ${t("corte.deposits")}: ${fmtSigned(r.deposits.total)}`);
  }
  return lines.join("\n");
}

/** Liga de WhatsApp que SOLO abre la app con el texto (no manda nada por la API). */
export function waMeLink(text: string): string {
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}
