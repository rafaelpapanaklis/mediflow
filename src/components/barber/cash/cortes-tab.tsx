"use client";

import { useEffect, useState } from "react";
import { Download, Printer, Receipt } from "lucide-react";
import type { Dictionary } from "@/i18n/t";
import type { CorteRow } from "@/lib/barber/cash";
import { differenceKind } from "@/lib/barber/caja-movimientos-core";
import { BadgeNew } from "@/components/ui/design-system/badge-new";
import { useBarberT } from "./use-barber-t";
import { fmtDateTime, fmtMoney, toCents } from "./money";
import { PeriodNav } from "./period-nav";
import { corteDiffLabel } from "./corte-core";
import { SessionDetailModal } from "./session-detail";

/**
 * Pestaña «Cortes» (ws6-t1): los cortes del mes, quién abrió y cerró,
 * esperado, contado y diferencia. Abrir uno = todo su detalle y reimprimir.
 * Exportar CSV del mes (lo arma el servidor con las mismas cifras).
 */
export function CortesTab({ dict, tz, locale, currentPeriod }: { dict: Dictionary; tz: string; locale: string; currentPeriod: string }) {
  const t = useBarberT(dict);
  const [period, setPeriod] = useState(currentPeriod);
  const [rows, setRows] = useState<CorteRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [detail, setDetail] = useState<CorteRow | null>(null);

  useEffect(() => {
    let alive = true;
    setRows(null);
    setFailed(false);
    fetch(`/api/barber/cash-sessions/cortes?period=${encodeURIComponent(period)}`, { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        const json = (await res.json()) as { rows: CorteRow[] };
        if (alive) setRows(json.rows);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [period]);

  return (
    <>
    <div className="card" style={{ padding: 0, overflow: "hidden" }} data-pestana="cortes">
      <div className="bcaja-toolbar">
        <PeriodNav period={period} onChange={setPeriod} locale={locale} prevLabel={t("common.prevPeriod")} nextLabel={t("common.nextPeriod")} maxPeriod={currentPeriod} />
        <span style={{ flex: 1 }} />
        <a className="btn-new btn-new--secondary btn-new--sm" href={`/api/barber/cash-sessions/cortes?period=${encodeURIComponent(period)}&format=csv`} download data-csv-cortes>
          <Download size={14} /> {t("tabs.csv")}
        </a>
      </div>
      {failed ? (
        <div className="bcaja-alert bcaja-alert--danger" role="alert" style={{ margin: 14 }}>{t("common.error")}</div>
      ) : rows === null ? (
        <p className="bcaja-hint" style={{ margin: 0, padding: 18 }}>{t("common.loading")}</p>
      ) : rows.length === 0 ? (
        <p className="bcaja-hint" style={{ margin: 0, padding: 18 }}>{t("tabs.cortesEmpty")}</p>
      ) : (
        <div className="bcaja-table-wrap">
          <table className="table-new bcaja-hist">
            <thead>
              <tr>
                <th>{t("caja.colOpened")}</th>
                <th>{t("caja.colClosed")}</th>
                <th className="bcaja-num">{t("caja.colExpected")}</th>
                <th className="bcaja-num">{t("caja.colCounted")}</th>
                <th>{t("caja.colDifference")}</th>
                <th className="bcaja-num">{t("cards.income")}</th>
                <th className="bcaja-num">{t("cards.expenses")}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const diff = r.countedAmount !== null && r.expectedAmount !== null ? toCents(r.countedAmount) - toCents(r.expectedAmount) : null;
                const kind = diff === null ? null : differenceKind(diff);
                return (
                  <tr key={r.id} data-corte-fila={r.id}>
                    <td data-label={t("caja.colOpened")}>{fmtDateTime(r.openedAt, tz)} · {r.openedByName}</td>
                    <td data-label={t("caja.colClosed")}>{r.closedAt ? `${fmtDateTime(r.closedAt, tz)} · ${r.closedByName ?? "—"}` : <BadgeNew tone="info">{t("tabs.stillOpen")}</BadgeNew>}</td>
                    <td className="bcaja-num" data-label={t("caja.colExpected")}>{fmtMoney(r.expectedAmount ?? r.resumen.expectedCash)}</td>
                    <td className="bcaja-num" data-label={t("caja.colCounted")}>{r.countedAmount === null ? "—" : fmtMoney(r.countedAmount)}</td>
                    <td data-label={t("caja.colDifference")}>
                      {diff === null ? "—" : <BadgeNew tone={kind === "ok" ? "success" : kind === "over" ? "info" : "danger"}>{corteDiffLabel(t, diff)}</BadgeNew>}
                    </td>
                    <td className="bcaja-num" data-label={t("cards.income")}>{fmtMoney(r.resumen.income.total)}</td>
                    <td className="bcaja-num" data-label={t("cards.expenses")}>{fmtMoney(r.resumen.expenses.total)}</td>
                    <td>
                      <span className="bcaja-row-actions">
                        <button type="button" className="icon-btn-new" title={t("caja.historyView")} aria-label={t("caja.historyView")} onClick={() => setDetail(r)}>
                          <Receipt size={13} />
                        </button>
                        <a href={`/barber/caja/corte/${encodeURIComponent(r.id)}`} className="icon-btn-new" title={t("corte.reprint")} aria-label={t("corte.reprint")}>
                          <Printer size={13} />
                        </a>
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
      {detail && <SessionDetailModal dict={dict} row={detail} tz={tz} onClose={() => setDetail(null)} />}
    </>
  );
}
