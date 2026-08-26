"use client";

// ═══════════════════════════════════════════════════════════════════════
// Piezas compartidas de /inmobiliaria/reportes.
//
// Se reutiliza el kit de Rentas (Card, Kpi, Note, Pill, Tabs) y su CSS: son
// del mismo vertical, ya están hechos con los tokens del panel verde y
// clonarlos solo garantizaría que un día se vean distintos. Lo único que
// vive aquí es lo que Reportes necesita y aquello no tiene: pintar dinero
// SIN colapsar monedas.
//
// 🔴 LA REGLA: ningún componente de este archivo acepta un `number` suelto
// como "el total". O recibe MoneyByCurrency —y entonces pinta un renglón
// por moneda— o recibe centavos JUNTO A su moneda. Es lo que impide que
// alguien, dentro de seis meses, sume un dólar como si fuera un peso.
// ═══════════════════════════════════════════════════════════════════════

import type { ReactNode } from "react";
import { Download, FileDown } from "lucide-react";
import { formatCents } from "@/lib/realty/rent-charges";
import type { RealtyCurrency } from "@/lib/realty/types";
import {
  activeCurrencies,
  formatPctOrDash,
  isMixedCurrency,
  moneyRows,
  type MoneyByCurrency,
  type YieldResult,
} from "@/lib/realty/owner-report";
import { Note } from "../rentals/ui";
import "../rentals/rentals.css";
import "./reports.css";

// ── Dinero ──────────────────────────────────────────────────────────────

/** Un importe con SU moneda. La moneda no es opcional a propósito. */
export function Money({
  cents,
  currency,
}: {
  cents: number;
  currency: RealtyCurrency;
}) {
  return <span className="rep-money">{formatCents(cents, currency)}</span>;
}

/**
 * Un total por moneda. Con una sola moneda se ve como cualquier importe;
 * con dos, salen dos renglones — nunca una suma de las dos.
 */
export function MoneyLine({
  money,
  zero = "MXN",
  block,
}: {
  money: MoneyByCurrency;
  /** Qué moneda usar para pintar el cero cuando no hubo movimiento. */
  zero?: RealtyCurrency;
  block?: boolean;
}) {
  const rows = moneyRows(money);
  if (rows.length === 0) {
    return <span className="rep-money">{formatCents(0, zero)}</span>;
  }
  return (
    <span className={block ? "rep-money-stack rep-money-stack--block" : "rep-money-stack"}>
      {rows.map((r) => (
        <span key={r.currency} className="rep-money">
          {r.label}
          {rows.length > 1 ? <em className="rep-money__cur">{r.currency}</em> : null}
        </span>
      ))}
    </span>
  );
}

/** El aviso de mezcla. Se pinta SOLO cuando de verdad hay dos monedas. */
export function MixedCurrencyNote({
  money,
  text,
  extra,
}: {
  money: MoneyByCurrency | MoneyByCurrency[];
  text: string;
  extra?: string;
}) {
  const list = Array.isArray(money) ? money : [money];
  const mixed = list.some((m) => isMixedCurrency(m));
  if (!mixed) return null;
  return (
    <Note tone="warning">
      {text}
      {extra ? <> {extra}</> : null}
    </Note>
  );
}

/** Las monedas presentes en un conjunto de totales, sin repetir. */
export function currenciesOf(list: MoneyByCurrency[]): RealtyCurrency[] {
  const out: RealtyCurrency[] = [];
  for (const m of list) {
    for (const c of activeCurrencies(m)) {
      if (!out.includes(c)) out.push(c);
    }
  }
  return out;
}

/** Un porcentaje de rendimiento, con su explicación cuando no se pudo emitir. */
export function YieldCell({
  value,
  blockedText,
}: {
  value: YieldResult;
  blockedText: string | null;
}) {
  if (value.netPct === null) {
    return (
      <span className="rep-yield rep-yield--none" title={blockedText ?? undefined}>
        —
      </span>
    );
  }
  const tone = value.netPct >= 5 ? "good" : value.netPct > 0 ? "mid" : "bad";
  return <span className={`rep-yield rep-yield--${tone}`}>{formatPctOrDash(value.netPct)}</span>;
}

// ── Encabezado de bloque ────────────────────────────────────────────────

export function BlockHead({
  title,
  sub,
  note,
  right,
}: {
  title: string;
  sub?: string;
  note?: string;
  right?: ReactNode;
}) {
  return (
    <div className="rep-blockhead">
      <div style={{ minWidth: 0 }}>
        <h2 className="rep-blockhead__title">{title}</h2>
        {sub ? <p className="rep-blockhead__sub">{sub}</p> : null}
        {note ? <p className="rep-blockhead__note">{note}</p> : null}
      </div>
      {right ? <div className="rep-blockhead__right">{right}</div> : null}
    </div>
  );
}

// ── Exportar ────────────────────────────────────────────────────────────

/**
 * PDF y hoja de cálculo. Los dos son GET, así que van como `<a href>` y no
 * como fetch + Blob: es el patrón del vertical y además deja que el
 * navegador haga su trabajo (reanudar, abrir en pestaña, guardar donde el
 * usuario quiera) sin una línea de JavaScript.
 */
export function ExportBar({
  pdfHref,
  csvHref,
  pdfLabel,
  csvLabel,
  children,
}: {
  pdfHref?: string | null;
  csvHref?: string | null;
  pdfLabel: string;
  csvLabel: string;
  children?: ReactNode;
}) {
  return (
    <div className="rep-exports">
      {children}
      {pdfHref ? (
        <a className="rnt-btn rnt-btn--sm" href={pdfHref} target="_blank" rel="noreferrer">
          <FileDown size={13} />
          {pdfLabel}
        </a>
      ) : null}
      {csvHref ? (
        <a className="rnt-btn rnt-btn--sm" href={csvHref}>
          <Download size={13} />
          {csvLabel}
        </a>
      ) : null}
    </div>
  );
}

// ── Periodo ─────────────────────────────────────────────────────────────

export function PeriodBar({
  from,
  to,
  onFrom,
  onTo,
  onApply,
  labels,
  presets,
}: {
  from: string;
  to: string;
  onFrom: (v: string) => void;
  onTo: (v: string) => void;
  onApply: () => void;
  labels: { desde: string; hasta: string; aplicar: string };
  presets?: ReactNode;
}) {
  return (
    <div className="rep-period">
      <label className="rep-period__field">
        <span>{labels.desde}</span>
        <input
          type="date"
          className="rnt-input"
          value={from}
          onChange={(e) => onFrom(e.target.value)}
        />
      </label>
      <label className="rep-period__field">
        <span>{labels.hasta}</span>
        <input
          type="date"
          className="rnt-input"
          value={to}
          onChange={(e) => onTo(e.target.value)}
        />
      </label>
      <button type="button" className="rnt-btn rnt-btn--sm rnt-btn--primary" onClick={onApply}>
        {labels.aplicar}
      </button>
      {presets}
    </div>
  );
}

// ── Tabla que se desborda con elegancia ────────────────────────────────

/**
 * Toda tabla de este reporte va envuelta aquí. Sin el contenedor con
 * overflow propio, una tabla de doce columnas empuja el ancho del panel y
 * es la PÁGINA la que se desplaza en horizontal — con el menú y todo.
 */
export function TableWrap({ children }: { children: ReactNode }) {
  return <div className="rnt-tablewrap">{children}</div>;
}

/** Un dato pequeño bajo un número grande, para no repetir markup. */
export function Hint({ children }: { children: ReactNode }) {
  return <div className="rep-hint">{children}</div>;
}
