"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Printer } from "lucide-react";
import type { Dictionary } from "@/i18n/t";
import type { CashSessionRow, CashSessionSummary } from "@/lib/barber/cash";
import type { BarberPaymentMethod } from "@/lib/barber/types";
import { BadgeNew } from "@/components/ui/design-system/badge-new";
import { BarberModal } from "./modal";
import { useBarberT } from "./use-barber-t";
import { fmtDateTime, fmtMoney, fmtTime, PAYMENT_METHOD_KEYS } from "./money";

/**
 * Tickets de un turno YA CERRADO (lógica L2): «el cliente dice que ayer le
 * cobraron de más» o «reimprime el ticket del sábado». Antes «Turnos
 * anteriores» solo daba totales y no había forma de llegar a esos tickets.
 * Lee GET /api/barber/cash-sessions/[id] (cash.view); solo consultar y
 * reimprimir: un turno cerrado no se toca.
 */
export function SessionDetailModal({
  dict,
  row,
  tz,
  onClose,
}: {
  dict: Dictionary;
  row: CashSessionRow;
  tz: string;
  onClose: () => void;
}) {
  const t = useBarberT(dict);
  const [data, setData] = useState<CashSessionSummary | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch(`/api/barber/cash-sessions/${encodeURIComponent(row.id)}`, { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        const json = (await res.json()) as CashSessionSummary;
        if (alive) setData(json);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [row.id]);

  const methodLabel = (m: BarberPaymentMethod) => t(PAYMENT_METHOD_KEYS[m]);

  return (
    <BarberModal open wide title={t("caja.historyDetailTitle", { date: fmtDateTime(row.openedAt, tz) })} onClose={onClose} closeLabel={t("common.close")}>
      <p className="bcaja-hint" style={{ margin: "0 0 10px" }}>{t("caja.historyDetailClosed")}</p>
      {failed ? (
        <div className="bcaja-alert bcaja-alert--danger" role="alert">{t("common.error")}</div>
      ) : !data ? (
        <p className="bcaja-hint" style={{ margin: 0 }}>{t("common.loading")}</p>
      ) : (
        <>
          <div className="bcaja-low" aria-label={t("caja.byMethod")} style={{ marginBottom: 10 }}>
            {(["CASH", "CARD", "SPEI"] as BarberPaymentMethod[]).map((m) => (
              <span key={m} className="bcaja-low__item" style={{ background: "var(--bg-elev)", color: "var(--text-2)", borderColor: "var(--border-soft)" }}>
                {methodLabel(m)}: <strong style={{ color: "var(--text-1)" }}>{fmtMoney(data.byMethod[m].total)}</strong>
                <span className="bcaja-muted">({data.byMethod[m].count})</span>
              </span>
            ))}
          </div>
          {data.sales.length === 0 ? (
            <p className="bcaja-hint" style={{ margin: 0 }}>{t("caja.historyDetailEmpty")}</p>
          ) : (
            <div className="bcaja-table-wrap">
              <table className="table-new bcaja-tickets">
                <thead>
                  <tr>
                    <th>{t("caja.colTime")}</th>
                    <th>{t("caja.colClient")}</th>
                    <th>{t("caja.colBarber")}</th>
                    <th>{t("caja.colItems")}</th>
                    <th>{t("caja.colMethod")}</th>
                    <th className="bcaja-num">{t("caja.colTip")}</th>
                    <th className="bcaja-num">{t("caja.colTotal")}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {data.sales.map((s) => (
                    <tr key={s.id} className={s.cancelled ? "bcaja-strike" : undefined}>
                      <td data-label={t("caja.colTime")}>{fmtTime(s.createdAt, tz)}</td>
                      <td data-label={t("caja.colClient")}>{s.clientName ?? <span className="bcaja-muted">{t("common.none")}</span>}</td>
                      <td data-label={t("caja.colBarber")}>{s.barberName ?? <span className="bcaja-muted">{t("common.none")}</span>}</td>
                      <td data-label={t("caja.colItems")} style={{ whiteSpace: "normal", maxWidth: 260 }}>
                        {s.cancelled ? <BadgeNew tone="neutral">{t("common.cancelled")}</BadgeNew> : s.itemsSummary}
                      </td>
                      <td data-label={t("caja.colMethod")}>
                        {methodLabel(s.paymentMethod)}
                        {(s.methodChanges ?? []).length > 0 ? (
                          <span className="bcaja-muted" style={{ display: "block", fontSize: 11.5 }}>
                            {t("caja.changedFrom", { method: methodLabel(s.methodChanges[0].from) })}
                          </span>
                        ) : null}
                      </td>
                      <td className="bcaja-num" data-label={t("caja.colTip")}>{fmtMoney(s.tip)}</td>
                      <td className="bcaja-num" data-label={t("caja.colTotal")}><strong>{fmtMoney(s.total)}</strong></td>
                      <td>
                        <span className="bcaja-row-actions">
                          <Link href={`/barber/caja/ticket/${s.id}`} className="icon-btn-new" title={t("caja.view")} aria-label={t("caja.view")}>
                            <Printer size={13} />
                          </Link>
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
    </BarberModal>
  );
}
