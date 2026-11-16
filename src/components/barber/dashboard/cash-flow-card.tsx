"use client";

import { ArrowDownRight, ArrowUpRight, Download } from "lucide-react";
import { CardNew } from "@/components/ui/design-system/card-new";
import type { ReportCashFlow } from "@/lib/barber/stats";
import { fmtInt, fmtMoney, fmtPctSigned } from "./format";

/**
 * «Ingresos y gastos» de Reportes (ws6-t5). Solo pinta: TODO el dinero ya
 * viene calculado del servidor (cajaResumen de ws6-t1 vía caja-dinero.ts),
 * y solo viaja a quien tiene «Ver caja».
 *
 * Arriba la cuenta, renglón por renglón (cobrado − propinas = ingresos −
 * gastos − pagos = ganancia), para que el número grande se pueda revisar.
 * Abajo, barras de un solo tono por medio de cobro y por categoría de gasto
 * (el largo es el importe y el texto lo dice; nada solo con color).
 */
const METHODS = ["CASH", "CARD", "SPEI", "ONLINE"] as const;
const KINDS = ["ADVANCE", "COMMISSION", "SALARY", "OTHER"] as const;

function neg(n: number): string {
  return n > 0 ? `−${fmtMoney(n)}` : fmtMoney(0);
}
function signed(n: number): string {
  return n < 0 ? `−${fmtMoney(-n)}` : fmtMoney(n);
}

export function CashFlowCard({
  cf,
  locale,
  csvHref,
  t,
}: {
  cf: ReportCashFlow;
  locale: string;
  csvHref: string;
  t: (key: string, vars?: Record<string, string | number>) => string;
}) {
  const c = cf.current;
  const k = (key: string, vars?: Record<string, string | number>) => t(`money.${key}`, vars);
  const methodMax = Math.max(0, ...METHODS.map((m) => c.byMethod[m].total));
  const catMax = Math.max(0, ...c.expenses.byCategory.map((r) => r.total));
  const kinds = KINDS.filter((kd) => c.payouts.byKind[kd] > 0);
  const delta = cf.vsPrevProfitPct;
  const bc = c.barberCost;

  return (
    <CardNew
      title={k("title")}
      sub={cf.barberFiltered ? k("subFiltered") : k("sub")}
      action={
        <a href={csvHref} className="btn-new btn-new--ghost btn-new--sm bdash-btn-icon" download>
          <Download size={14} aria-hidden /> {k("export")}
        </a>
      }
    >
      <div className="bdash-money">
        <div>
          <div className={`bdash-big${c.profit < 0 ? " bdash-big--neg" : ""}`}>{signed(c.profit)}</div>
          <div className="bdash-big__label">
            {k("profit")} · {k("profitHint")}
          </div>
          {delta !== null && (
            <div className={`bdash-band__delta bdash-band__delta--${delta >= 0 ? "up" : "down"}`}>
              {delta >= 0 ? <ArrowUpRight size={13} aria-hidden /> : <ArrowDownRight size={13} aria-hidden />}
              {fmtPctSigned(delta, locale)}
              <span>{k("vsPrev")}</span>
            </div>
          )}
          <div className="bdash-big__label">{k("prevProfit", { amount: signed(cf.previous.profit) })}</div>

          <dl className="bdash-ledger">
            <div className="bdash-ledger__row">
              <dt>{k("charged")}</dt>
              <dd>{fmtMoney(c.charged)}</dd>
            </div>
            <div className="bdash-ledger__row bdash-ledger__row--neg">
              <dt>
                {k("tips")}
                <span className="bdash-ledger__meta">{k("tipsApart", { amount: fmtMoney(c.tips) })}</span>
              </dt>
              <dd>{neg(c.tips)}</dd>
            </div>
            <div className="bdash-ledger__row bdash-ledger__row--total">
              <dt>{k("income")}</dt>
              <dd>{signed(c.income)}</dd>
            </div>
            <div className="bdash-ledger__row bdash-ledger__row--neg">
              <dt>
                {k("lessExpenses")}
                {c.expenses.count > 0 && (
                  <span className="bdash-ledger__meta">
                    {k("expensesCount", { count: c.expenses.count })}
                    {c.expenses.cash > 0 ? ` · ${k("expensesCash", { amount: fmtMoney(c.expenses.cash) })}` : ""}
                    {cf.vsPrevExpensesPct !== null ? ` · ${fmtPctSigned(cf.vsPrevExpensesPct, locale)} ${k("vsPrev")}` : ""}
                  </span>
                )}
              </dt>
              <dd>{neg(c.expenses.total)}</dd>
            </div>
            <div className="bdash-ledger__row bdash-ledger__row--neg">
              <dt>
                {k("lessBarberCost")}
                <span className="bdash-ledger__meta">
                  {k("barberCostHint")}
                  {" · "}
                  {k("barberCostParts", { commission: fmtMoney(bc.commission), salary: fmtMoney(bc.salary) })}
                  {bc.chairRent > 0 ? ` · ${k("chairRent", { amount: `−${fmtMoney(bc.chairRent)}` })}` : ""}
                  {bc.approx ? ` · ${k("approx")}` : ""}
                </span>
              </dt>
              {/* Negativo = la renta de silla supera lo que les toca: suma a la ganancia. */}
              <dd>{bc.total < 0 ? `+${fmtMoney(-bc.total)}` : neg(bc.total)}</dd>
            </div>
            <div className="bdash-ledger__row bdash-ledger__row--total">
              <dt>{k("profit")}</dt>
              <dd>{signed(c.profit)}</dd>
            </div>
          </dl>
          <div className="bdash-foot">
            <span>
              {k("cashNet")}: <strong>{signed(c.cashNet)}</strong>
            </span>
            <span>{k("cashNetHint")}</span>
          </div>
          <div className="bdash-foot">
            <span>{k("onlineNotIncluded")}</span>
          </div>
        </div>

        <div>
          <h3 className="bdash-money__sub">{k("byMethod")}</h3>
          <div className="bdash-bars">
            {METHODS.filter((m) => m !== "ONLINE" || c.byMethod[m].count > 0).map((m) => {
              const row = c.byMethod[m];
              return (
                <div className="bdash-bar" key={m}>
                  <div className="bdash-bar__head">
                    <span className="bdash-bar__name">{k(`methods.${m}`)}</span>
                    <span className="bdash-bar__val">{signed(row.total)}</span>
                  </div>
                  <div className="bdash-bar__track" aria-hidden>
                    <div className="bdash-bar__fill" style={{ width: `${methodMax > 0 && row.total > 0 ? Math.max(1, (row.total / methodMax) * 100) : 0}%` }} />
                  </div>
                  <div className="bdash-bar__meta">
                    <span>
                      {fmtInt(row.count, locale)} {t("payments.colTickets").toLowerCase()}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="bdash-big__label" style={{ marginTop: 6 }}>{k("byMethodHint")}</div>

          <h3 className="bdash-money__sub" style={{ marginTop: 18 }}>{k("byCategory")}</h3>
          {c.expenses.byCategory.length === 0 ? (
            <div className="bdash-empty" style={{ textAlign: "left", padding: "4px 0" }}>{k("byCategoryEmpty")}</div>
          ) : (
            <div className="bdash-bars">
              {c.expenses.byCategory.map((r) => (
                <div className="bdash-bar" key={r.category}>
                  <div className="bdash-bar__head">
                    <span className="bdash-bar__name" title={catLabel(k, r.category)}>{catLabel(k, r.category)}</span>
                    <span className="bdash-bar__val">{fmtMoney(r.total)}</span>
                  </div>
                  <div className="bdash-bar__track" aria-hidden>
                    <div className="bdash-bar__fill bdash-bar__fill--exp" style={{ width: `${catMax > 0 ? Math.max(1, (r.total / catMax) * 100) : 0}%` }} />
                  </div>
                  <div className="bdash-bar__meta">
                    <span>{k("expensesCount", { count: r.count })}</span>
                  </div>
                </div>
              ))}
            </div>
          )}

          <h3 className="bdash-money__sub" style={{ marginTop: 18 }}>{k("byKind")}</h3>
          <div className="bdash-big__label" style={{ margin: "0 0 6px" }}>
            {k("paidOut")}: <strong>{fmtMoney(c.payouts.total)}</strong>
            {c.payouts.count > 0 ? ` · ${k("payoutsCount", { count: c.payouts.count })}` : ""} · {k("paidOutHint")}
          </div>
          {kinds.length === 0 ? (
            <div className="bdash-empty" style={{ textAlign: "left", padding: "4px 0" }}>{k("byKindEmpty")}</div>
          ) : (
            <dl className="bdash-ledger" style={{ marginTop: 0 }}>
              {kinds.map((kd) => (
                <div className="bdash-ledger__row" key={kd}>
                  <dt>{k(`kind.${kd}`)}</dt>
                  <dd>{fmtMoney(c.payouts.byKind[kd])}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      </div>
    </CardNew>
  );
}

/** Categoría guardada como CLAVE (caja-movimientos-core); una que no conozcamos se enseña tal cual. */
function catLabel(k: (key: string) => string, cat: string): string {
  const key = `cat.${cat}`;
  const label = k(key);
  return label === `money.${key}` ? cat : label;
}
