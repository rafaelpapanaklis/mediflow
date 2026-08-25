import type { ReportItemRow, ReportPayment } from "@/lib/barber/stats";
import { sumMoneyBy } from "@/lib/barber/money";
import type { BarberPaymentMethod } from "@/lib/barber/types";
import { fmtInt, fmtMoney, fmtPct } from "./format";

/**
 * Barras horizontales de un solo tono (una serie: el título dice qué es).
 * El largo es el ingreso; el texto lleva cantidad, peso y —en productos— el
 * margen. Nada se codifica solo con color.
 */
export function ItemBars({
  items,
  locale,
  kind,
  qtyLabel,
  shareLabel,
  marginLabel,
  noCostLabel,
}: {
  items: ReportItemRow[];
  locale: string;
  kind: "service" | "product";
  qtyLabel: string;
  shareLabel: string;
  marginLabel: string;
  noCostLabel: string;
}) {
  const max = items.reduce((m, it) => Math.max(m, it.revenue), 0);
  return (
    <div className="bdash-bars">
      {items.map((it) => (
        <div className="bdash-bar" key={it.id}>
          <div className="bdash-bar__head">
            <span className="bdash-bar__name" title={it.name}>
              {it.name}
            </span>
            <span className="bdash-bar__val">{fmtMoney(it.revenue)}</span>
          </div>
          <div className="bdash-bar__track" aria-hidden>
            <div
              className={`bdash-bar__fill${kind === "product" ? " bdash-bar__fill--s2" : ""}`}
              style={{ width: `${max > 0 ? Math.max(1, (it.revenue / max) * 100) : 0}%` }}
            />
          </div>
          <div className="bdash-bar__meta">
            <span>
              {qtyLabel} {fmtInt(it.qty, locale)}
            </span>
            {it.share !== null && (
              <span>
                {shareLabel} {fmtPct(it.share)}
              </span>
            )}
            {kind === "product" && (
              <span>
                {it.margin === null ? noCostLabel : `${marginLabel} ${fmtMoney(it.margin)} (${fmtPct(it.marginPct)})`}
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

const METHOD_SLOT: Record<BarberPaymentMethod, number> = { CASH: 1, CARD: 2, SPEI: 3, STRIPE: 4 };

/** Barra apilada del reparto por método + su lista con números. */
export function PaymentsBar({
  payments,
  locale,
  methodLabels,
  ticketsLabel,
}: {
  payments: ReportPayment[];
  locale: string;
  methodLabels: Record<string, string>;
  ticketsLabel: string;
}) {
  const withMoney = payments.filter((p) => p.total > 0);
  const sum = sumMoneyBy(withMoney, (p) => p.total);
  return (
    <div>
      {withMoney.length > 0 && (
        <div className="bdash-stackbar" aria-hidden>
          {withMoney.map((p) => (
            <div
              key={p.method}
              className={`bdash-stackbar__seg bdash-swatch--${METHOD_SLOT[p.method]}`}
              style={{ width: `${sum > 0 ? (p.total / sum) * 100 : 0}%` }}
              title={`${methodLabels[p.method] ?? p.method}: ${fmtMoney(p.total)}`}
            />
          ))}
        </div>
      )}
      <div className="bdash-list" style={{ marginTop: 12 }}>
        {payments.map((p) => (
          <div className="bdash-row" key={p.method} style={{ padding: "8px 10px" }}>
            <span className={`bdash-legend__swatch bdash-swatch--${METHOD_SLOT[p.method]}`} aria-hidden />
            <div className="bdash-row__main">
              <div className="bdash-row__name">{methodLabels[p.method] ?? p.method}</div>
              <div className="bdash-row__meta">
                {fmtInt(p.count, locale)} {ticketsLabel}
                {p.share !== null ? ` · ${fmtPct(p.share)}` : ""}
              </div>
            </div>
            <div className="bdash-row__n">{fmtMoney(p.total)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
