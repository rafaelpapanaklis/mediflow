"use client";

import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";
import { Download, Image as ImageIcon, ShoppingBag, XCircle } from "lucide-react";
import type { Dictionary } from "@/i18n/t";
import type { CashMovementRow } from "@/lib/barber/cash-movements";
import type { ExpensesList } from "@/lib/barber/caja-movimientos";
import { CASH_EXPENSE_CATEGORIES } from "@/lib/barber/caja-movimientos-core";
import { useBarberT } from "./use-barber-t";
import { fmtDateTime, fmtMoney } from "./money";
import { PeriodNav } from "./period-nav";
import { categoryLabel, MovementModal, VoidMovementModal } from "./movement-modals";

/**
 * Pestaña «Gastos» (ws6-t1): TODOS los gastos del mes, también los pagados
 * con tarjeta o transferencia sin caja abierta (renta, luz). Filtro por mes
 * y categoría, total por categoría y CSV. Registrar un gasto aquí NO exige
 * caja abierta: en efectivo con caja abierta cae en esa caja; sin caja,
 * queda fuera y se avisa.
 */
export function GastosTab({
  dict,
  tz,
  locale,
  currentPeriod,
  canAdd,
  openSessionId,
  drawerCash = null,
  onChanged,
}: {
  /** Lo que debe haber en el cajón ahora (null sin caja): para avisar de un gasto en efectivo mayor. */
  drawerCash?: number | null;
  dict: Dictionary;
  tz: string;
  locale: string;
  currentPeriod: string;
  /** cash.expenses */
  canAdd: boolean;
  /** Turno abierto ahora (solo sus gastos o los de fuera de caja se pueden anular). */
  openSessionId: string | null;
  onChanged: () => void;
}) {
  const t = useBarberT(dict);
  const [period, setPeriod] = useState(currentPeriod);
  const [category, setCategory] = useState<string | null>(null);
  const [data, setData] = useState<ExpensesList | null>(null);
  const [failed, setFailed] = useState(false);
  const [adding, setAdding] = useState(false);
  const [voiding, setVoiding] = useState<CashMovementRow | null>(null);
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((x) => x + 1), []);

  useEffect(() => {
    let alive = true;
    setFailed(false);
    const q = new URLSearchParams({ period });
    if (category) q.set("category", category);
    fetch(`/api/barber/cash-movements/expenses?${q.toString()}`, { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        const json = (await res.json()) as ExpensesList;
        if (alive) setData(json);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [period, category, tick]);

  const csvHref = `/api/barber/cash-movements/expenses?${new URLSearchParams({ period, ...(category ? { category } : {}), format: "csv" }).toString()}`;
  const voidable = (m: CashMovementRow) => canAdd && !m.voidedAt && (m.sessionId === null || m.sessionId === openSessionId);

  return (
    <>
    <div className="card" style={{ padding: 0, overflow: "hidden" }} data-pestana="gastos">
      <div className="bcaja-toolbar">
        <PeriodNav period={period} onChange={setPeriod} locale={locale} prevLabel={t("common.prevPeriod")} nextLabel={t("common.nextPeriod")} maxPeriod={currentPeriod} />
        <span style={{ flex: 1 }} />
        {canAdd && (
          <button type="button" className="btn-new barber-btn-primary btn-new--sm" onClick={() => setAdding(true)} data-gasto-nuevo>
            <ShoppingBag size={14} /> {t("mov.title.EXPENSE")}
          </button>
        )}
        <a className="btn-new btn-new--secondary btn-new--sm" href={csvHref} download data-csv-gastos>
          <Download size={14} /> {t("tabs.csv")}
        </a>
      </div>
      <div className="bcaja-filters" role="radiogroup" aria-label={t("mov.category")} style={{ paddingTop: 0 }}>
        <button type="button" role="radio" aria-checked={category === null} className={`bcaja-chip ${category === null ? "bcaja-chip--on" : ""}`} onClick={() => setCategory(null)}>
          {t("day.f.all")}
        </button>
        {CASH_EXPENSE_CATEGORIES.map((c) => (
          <button key={c} type="button" role="radio" aria-checked={category === c} className={`bcaja-chip ${category === c ? "bcaja-chip--on" : ""}`} onClick={() => setCategory(c)}>
            {t(`mov.cat.${c}`)}
          </button>
        ))}
      </div>

      {failed ? (
        <div className="bcaja-alert bcaja-alert--danger" role="alert" style={{ margin: 14 }}>{t("common.error")}</div>
      ) : !data ? (
        <p className="bcaja-hint" style={{ margin: 0, padding: 18 }}>{t("common.loading")}</p>
      ) : (
        <>
          <div className="bcaja-totals" style={{ margin: "8px 14px" }} data-gastos-totales>
            {data.resumen.byCategory.map((c) => (
              <div key={c.category} className="bcaja-totals__row">
                <span>{categoryLabel(t, c.category)} <span className="bcaja-muted">({c.count})</span></span>
                <span>{fmtMoney(c.total)}</span>
              </div>
            ))}
            <div className="bcaja-totals__row bcaja-totals__row--big">
              <span>{t("common.total")}</span>
              <span>{fmtMoney(data.resumen.total)}</span>
            </div>
            {data.resumen.total > 0 && (
              <div className="bcaja-totals__note">
                {t("tabs.byMethod", {
                  cash: fmtMoney(data.resumen.byMethod.CASH),
                  card: fmtMoney(data.resumen.byMethod.CARD),
                  transfer: fmtMoney(data.resumen.byMethod.TRANSFER),
                  other: fmtMoney(data.resumen.byMethod.OTHER),
                })}
              </div>
            )}
          </div>
          {data.items.length === 0 ? (
            <p className="bcaja-hint" style={{ margin: 0, padding: 18 }}>{t("tabs.gastosEmpty")}</p>
          ) : (
            <div className="bcaja-table-wrap">
              <table className="table-new bcaja-tickets">
                <thead>
                  <tr>
                    <th>{t("tabs.colDate")}</th>
                    <th>{t("mov.category")}</th>
                    <th>{t("mov.note")}</th>
                    <th>{t("caja.colMethod")}</th>
                    <th>{t("day.colWho")}</th>
                    <th className="bcaja-num">{t("day.colAmount")}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {[...data.items].reverse().map((m) => (
                    <tr key={m.id} className={m.voidedAt ? "bcaja-strike" : undefined} data-gasto={m.id}>
                      <td data-label={t("tabs.colDate")}>{fmtDateTime(m.createdAt, tz)}</td>
                      <td data-label={t("mov.category")}>
                        {categoryLabel(t, m.category)}
                        {m.sessionId === null && <span className="bcaja-muted" style={{ display: "block", fontSize: 11.5 }}>{t("tabs.outside")}</span>}
                      </td>
                      <td data-label={t("mov.note")} style={{ whiteSpace: "normal" }}>
                        {m.note ?? <span className="bcaja-muted">—</span>}
                        {m.voidedAt && (
                          <span className="bcaja-muted" style={{ display: "block", fontSize: 11.5 }} data-anulado>
                            {t("day.voidedBy", { name: m.voidedByName ?? "—", when: fmtDateTime(m.voidedAt, tz) })}
                            {m.voidReason ? ` · ${m.voidReason}` : ""}
                          </span>
                        )}
                      </td>
                      <td data-label={t("caja.colMethod")}>{t(`mov.method.${m.method}`)}</td>
                      <td data-label={t("day.colWho")}>{m.createdByName}</td>
                      <td className="bcaja-num" data-label={t("day.colAmount")}><strong>{fmtMoney(m.amount)}</strong></td>
                      <td>
                        <span className="bcaja-row-actions">
                          {m.hasReceipt && (
                            <a href={`/api/barber/cash-movements/${m.id}/receipt`} target="_blank" rel="noopener noreferrer" className="icon-btn-new" title={t("mov.receiptView")} aria-label={t("mov.receiptView")}>
                              <ImageIcon size={13} />
                            </a>
                          )}
                          {voidable(m) && (
                            <button type="button" className="icon-btn-new" title={t("mov.void")} aria-label={t("mov.void")} onClick={() => setVoiding(m)}>
                              <XCircle size={13} />
                            </button>
                          )}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

    </div>
      {adding && (
        <MovementModal
          dict={dict}
          type="EXPENSE"
          sessionOpen={openSessionId !== null}
          drawerCash={drawerCash}
          onClose={() => setAdding(false)}
          onDone={(r) => {
            if (r.outsideSession) toast(t("mov.savedOutside"), { icon: "ℹ️" });
            else toast.success(t("mov.saved.EXPENSE"));
            setAdding(false);
            reload();
            onChanged();
          }}
        />
      )}
      {voiding && (
        <VoidMovementModal
          dict={dict}
          movement={voiding}
          tz={tz}
          onClose={() => setVoiding(null)}
          onDone={() => {
            toast.success(t("mov.voided"));
            setVoiding(null);
            reload();
            onChanged();
          }}
        />
      )}
    </>
  );
}
